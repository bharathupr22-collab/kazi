from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app.schemas.entities import LLMResult, utcnow
from app.services import assistant
from conftest import task


def proposal_stub(monkeypatch, actions, reply="Review this proposal", summary="Create a plan"):
    result = LLMResult(reply=reply, summary=summary if actions else "", actions=actions)
    monkeypatch.setattr(assistant, "ask_llm", lambda *args: result)


def chat(client):
    response = client.post("/api/assistant/chat", json={"message": "Plan my work"})
    assert response.status_code == 200, response.text
    return response.json()


def test_no_key_is_helpful_not_fake(client, user, app):
    app.state.settings.openai_api_key = None
    response = client.post("/api/assistant/chat", json={"message": "Create a task"})
    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]
    assert client.get("/api/tasks").json() == []


def test_proposal_no_writes_until_confirm_and_idempotent(client, user, other, db, monkeypatch):
    proposal_stub(monkeypatch, [
        {"type": "create_task", "task": {"title": "Research"}},
        {"type": "create_task", "task": {"title": "Draft", "subtasks": [{"title": "Outline"}]}},
    ])
    result = chat(client)
    proposal = result["proposal"]
    assert proposal["status"] == "pending"
    assert client.get("/api/tasks").json() == []
    assert other.post(f"/api/assistant/proposals/{proposal['id']}/confirm").status_code == 404
    url = f"/api/assistant/proposals/{proposal['id']}/confirm"
    assert client.post(url).status_code == 200
    assert client.post(url).status_code == 200
    assert len(client.get("/api/tasks").json()) == 2
    records = list(db.tasks.find({"user_id": user["id"]}))
    assert len({r["operation_id"] for r in records}) == 2
    assert db.proposals.find_one({"id": proposal["id"]})["status"] == "confirmed"


def test_concurrent_confirmation_does_not_duplicate(client, user, monkeypatch):
    proposal_stub(monkeypatch, [{"type": "create_task", "task": {"title": "Only once"}}])
    proposal = chat(client)["proposal"]
    url = f"/api/assistant/proposals/{proposal['id']}/confirm"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post(url).status_code, range(2)))
    assert results == [200, 200]
    assert len(client.get("/api/tasks").json()) == 1


def test_preflight_all_actions_before_writes(client, user, monkeypatch, db):
    item = task(client)
    actions = [
        {"type": "create_task", "task": {"title": "Must not be saved"}},
        {"type": "schedule_task", "task_id": item["id"], "start_at": "2030-01-01T10:00:00Z", "end_at": "2030-01-01T11:00:00Z"},
    ]
    proposal_stub(monkeypatch, actions)
    proposal = chat(client)["proposal"]
    # State changes after proposing: confirm must revalidate, not trust generation.
    assert client.post("/api/schedules", json={k: v for k, v in actions[1].items() if k != "type"}).status_code == 201
    response = client.post(f"/api/assistant/proposals/{proposal['id']}/confirm")
    assert response.status_code == 409
    assert len(client.get("/api/tasks").json()) == 1
    assert db.proposals.find_one({"id": proposal["id"]})["status"] == "pending"


def test_failure_mid_batch_rolls_back(client, user, monkeypatch, db):
    proposal_stub(monkeypatch, [{"type": "create_task", "task": {"title": "One"}}, {"type": "create_task", "task": {"title": "Two"}}])
    proposal = chat(client)["proposal"]
    original = assistant.create_task
    calls = []

    def fail_second(*args, **kwargs):
        calls.append(True)
        if len(calls) == 2:
            raise HTTPException(503, "Injected storage failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(assistant, "create_task", fail_second)
    assert client.post(f"/api/assistant/proposals/{proposal['id']}/confirm").status_code == 503
    assert db.tasks.count_documents({}) == 0
    assert db.proposals.find_one({"id": proposal["id"]})["status"] == "pending"
    monkeypatch.setattr(assistant, "create_task", original)
    assert client.post(f"/api/assistant/proposals/{proposal['id']}/confirm").status_code == 200
    assert db.tasks.count_documents({}) == 2


def test_schedule_proposal_and_expiry(client, user, monkeypatch):
    item = task(client)
    proposal_stub(monkeypatch, [{"type": "schedule_task", "task_id": item["id"], "start_at": "2030-01-01T10:00:00Z", "end_at": "2030-01-01T11:00:00Z"}])
    proposal = chat(client)["proposal"]
    assert client.get("/api/schedules").json() == []
    now = utcnow()
    monkeypatch.setattr(assistant, "utcnow", lambda: now + timedelta(days=2))
    assert client.post(f"/api/assistant/proposals/{proposal['id']}/confirm").status_code == 410
    monkeypatch.setattr(assistant, "utcnow", lambda: now)
    assert client.post(f"/api/assistant/proposals/{proposal['id']}/confirm").status_code == 200
    assert len(client.get("/api/schedules").json()) == 1


def test_invalid_foreign_key_and_internal_overlap_rejected(client, user, monkeypatch):
    proposal_stub(monkeypatch, [{"type": "create_task", "task": {"title": "Invalid project", "project_id": str(uuid4())}}])
    assert client.post("/api/assistant/chat", json={"message": "Create"}).status_code == 404
    item = task(client)
    action = {"type": "schedule_task", "task_id": item["id"], "start_at": "2030-01-01T10:00:00Z", "end_at": "2030-01-01T11:00:00Z"}
    proposal_stub(monkeypatch, [action, action])
    assert client.post("/api/assistant/chat", json={"message": "Schedule"}).status_code == 409


def test_actual_context_is_scoped_and_note_conversion(client, user, other, monkeypatch):
    own = task(client, title="My actual work")
    task(other, title="Secret other work")
    note = client.post("/api/notes", json={"title": "Real note", "content": "Book a venue and invite speakers"}).json()
    seen = []

    def inspect(settings, message, context):
        seen.append(context)
        assert [t["id"] for t in context["tasks"]] == [own["id"]]
        assert "Secret other work" not in str(context)
        assert context["analytics"]["total"] == 1
        return LLMResult(reply="You have one task", actions=[])

    monkeypatch.setattr(assistant, "ask_llm", inspect)
    assert chat(client)["proposal"] is None
    response = client.post(f"/api/notes/{note['id']}/convert")
    assert response.status_code == 200
    assert seen[-1]["note_to_convert"]["content"] == note["content"]
    assert len(client.get("/api/tasks").json()) == 1


def test_ai_cannot_fabricate_completed_work(client, user, monkeypatch):
    proposal_stub(monkeypatch, [{"type": "create_task", "task": {"title": "Fake work", "status": "completed", "actual_minutes": 60}}])
    assert client.post("/api/assistant/chat", json={"message": "Create"}).status_code == 502
    assert client.get("/api/tasks").json() == []


@pytest.mark.parametrize("content", ["not JSON", '{"reply":"ok","actions":[{"type":"delete_task"}]}', '{"reply":"ok","admin":true}', '{"reply":"ok","actions":[{"type":"create_task","task":{"title":"x","due_at":"tomorrow"}}]}'])
def test_provider_output_is_validated(app, monkeypatch, content):
    original = httpx.Client
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": [{"message": {"content": content}}]}))
    monkeypatch.setattr(assistant.httpx, "Client", lambda **kwargs: original(transport=transport, **kwargs))
    with pytest.raises(HTTPException) as exc:
        assistant.ask_llm(app.state.settings, "Create", {})
    assert exc.value.status_code == 502


def test_provider_http_request_and_response(app, monkeypatch):
    original = httpx.Client
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"reply":"No tasks yet","summary":"","actions":[]}'}}]})

    monkeypatch.setattr(assistant.httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    result = assistant.ask_llm(app.state.settings, "Analyze", {"tasks": []})
    assert result.reply == "No tasks yet"
    assert requests[0].url.path.endswith("/chat/completions")
    assert requests[0].headers["Authorization"] == "Bearer test-server-only-key"
