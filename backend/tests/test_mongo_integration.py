"""Optional real-replica tests. Never uses the development database name."""
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

from app.core.config import Settings
from app.main import create_app
from app.schemas.entities import LLMResult
from app.services import assistant

URI = os.environ.get("KAZI_TEST_MONGO_URI")
pytestmark = pytest.mark.skipif(not URI, reason="Set KAZI_TEST_MONGO_URI to run real replica-set tests")


@pytest.fixture
def real_client():
    name = "kazi_integration_" + uuid4().hex
    settings = Settings(_env_file=None, environment="test", mongo_uri=URI, mongo_database=name,
                        frontend_origin="http://localhost:3000", cookie_secure=False,
                        openai_api_key="test-only", auth_rate_limit=100)
    client = MongoClient(URI, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    app = create_app(settings)
    try:
        with TestClient(app, headers={"Origin": settings.frontend_origin}) as api:
            assert api.post("/api/auth/register", json={"name": "Real Mongo", "email": "real@example.com", "password": "real test password"}).status_code == 201
            yield api
    finally:
        client.drop_database(name)
        client.close()


def test_real_confirmation_retry_and_transaction_rollback(real_client, monkeypatch):
    actions = [{"type": "create_task", "task": {"title": "First"}}, {"type": "create_task", "task": {"title": "Second"}}]
    monkeypatch.setattr(assistant, "ask_llm", lambda *args: LLMResult(reply="Review proposal", summary="Plan", actions=actions))
    proposal = real_client.post("/api/assistant/chat", json={"message": "Plan"}).json()["proposal"]
    url = f"/api/assistant/proposals/{proposal['id']}/confirm"
    original = assistant.create_task
    calls = []

    def fail_second(*args, **kwargs):
        from fastapi import HTTPException
        calls.append(True)
        if len(calls) == 2:
            raise HTTPException(503, "Injected failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(assistant, "create_task", fail_second)
    assert real_client.post(url).status_code == 503
    assert real_client.get("/api/tasks").json() == []
    monkeypatch.setattr(assistant, "create_task", original)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: real_client.post(url).status_code, range(2)))
    assert all(result in {200, 409} for result in results)
    assert 200 in results
    assert real_client.post(url).status_code == 200
    assert len(real_client.get("/api/tasks").json()) == 2


def test_real_concurrent_schedule_conflict(real_client):
    task = real_client.post("/api/tasks", json={"title": "Scheduled"}).json()
    body = {"task_id": task["id"], "start_at": "2030-01-01T10:00:00Z", "end_at": "2030-01-01T11:00:00Z"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: real_client.post("/api/schedules", json=body).status_code, range(2)))
    assert sorted(results) == [201, 409]
    assert len(real_client.get("/api/schedules").json()) == 1
