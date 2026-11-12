from datetime import timedelta
from uuid import uuid4

import pytest

from app.schemas.entities import utcnow
from conftest import task


def test_task_all_fields_and_patch(client, user, db):
    project = client.post("/api/projects", json={"name": "Launch"}).json()
    sub_id = str(uuid4())
    item = task(client, description="Draft", category="Work", priority="high", status="in_progress",
                start_at="2030-01-01T12:00:00+02:00", due_at="2030-01-02T10:00:00Z", estimated_minutes=60,
                actual_minutes=15, subtasks=[{"id": sub_id, "title": "Research", "completed": True}, {"title": "Write"}],
                tags=["writing"], project_id=project["id"], reminder_minutes=10)
    assert item["start_at"] == "2030-01-01T10:00:00+00:00"
    assert item["subtasks"][0]["id"] == sub_id and item["subtasks"][1]["id"]
    assert set(item) == {"id", "title", "description", "category", "priority", "status", "start_at", "due_at", "estimated_minutes", "actual_minutes", "subtasks", "tags", "project_id", "reminder_minutes", "created_at", "updated_at", "completed_at"}
    result = client.patch(f"/api/tasks/{item['id']}", json={"status": "completed", "actual_minutes": 45}).json()
    assert result["completed_at"]
    assert db.activity.count_documents({"user_id": user["id"], "event": "completed"}) == 1
    client.patch(f"/api/tasks/{item['id']}", json={"status": "completed"})
    assert db.activity.count_documents({"event": "completed"}) == 1
    result = client.patch(f"/api/tasks/{item['id']}", json={"status": "todo", "project_id": None, "due_at": None}).json()
    assert result["completed_at"] is None and result["project_id"] is None
    assert db.activity.count_documents({"event": "reopened"}) == 1
    assert client.delete(f"/api/tasks/{item['id']}").status_code == 204
    assert client.get("/api/tasks").json() == []


@pytest.mark.parametrize("extra", [
    {"unexpected": True}, {"title": " "}, {"priority": "urgent"}, {"estimated_minutes": -1},
    {"estimated_minutes": 1.5}, {"estimated_minutes": True}, {"due_at": "2030-01-01T12:00:00"},
    {"project_id": "x"}, {"start_at": "2031-01-01T00:00:00Z", "due_at": "2030-01-01T00:00:00Z"},
    {"tags": ["x" * 51]}, {"subtasks": [{"title": "a", "admin": True}]},
])
def test_task_validation(client, user, extra):
    response = client.post("/api/tasks", json={"title": "Valid", **extra})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_patch_merged_date_validation(client, user):
    item = task(client, start_at="2030-01-02T00:00:00Z", due_at="2030-01-03T00:00:00Z")
    assert client.patch(f"/api/tasks/{item['id']}", json={"due_at": "2030-01-01T00:00:00Z"}).status_code == 422
    assert client.patch(f"/api/tasks/{item['id']}", json={"title": None}).status_code == 422


def test_projects_progress_and_detachment(client, user):
    project = client.post("/api/projects", json={"name": "Release", "start_at": "2030-01-01T00:00:00Z", "deadline": "2030-02-01T00:00:00Z"}).json()
    task(client, project_id=project["id"], status="completed")
    task(client, project_id=project["id"])
    view = client.get("/api/projects").json()[0]
    assert (view["task_count"], view["completed_count"], view["progress"]) == (2, 1, 50)
    assert client.patch(f"/api/projects/{project['id']}", json={"name": "Released", "priority": "high"}).json()["name"] == "Released"
    assert client.patch(f"/api/projects/{project['id']}", json={"deadline": "2029-01-01T00:00:00Z"}).status_code == 422
    assert client.delete(f"/api/projects/{project['id']}").status_code == 204
    assert all(item["project_id"] is None for item in client.get("/api/tasks").json())


def test_notes_crud(client, user):
    note = client.post("/api/notes", json={"title": "Idea", "content": "Build it"}).json()
    assert client.get("/api/notes").json() == [note]
    assert client.patch(f"/api/notes/{note['id']}", json={"content": "Plan it"}).json()["content"] == "Plan it"
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert client.get("/api/notes").json() == []


def test_scheduling_conflicts_boundaries_and_cascade(client, user, other):
    item = task(client)
    body = {"task_id": item["id"], "start_at": "2030-01-01T10:00:00Z", "end_at": "2030-01-01T11:00:00Z"}
    first = client.post("/api/schedules", json=body)
    assert first.status_code == 201
    assert first.json()["task_title"] == item["title"]
    response = client.post("/api/schedules", json={**body, "start_at": "2030-01-01T10:30:00Z"})
    assert response.status_code == 409 and "different time" in response.json()["detail"]
    second = client.post("/api/schedules", json={**body, "start_at": "2030-01-01T11:00:00Z", "end_at": "2030-01-01T12:00:00Z"})
    assert second.status_code == 201
    assert client.patch(f"/api/schedules/{first.json()['id']}", json={"start_at": "2030-01-01T10:30:00Z", "end_at": "2030-01-01T11:30:00Z"}).status_code == 409
    # Another user can occupy the same interval without any information leak.
    theirs = task(other)
    assert other.post("/api/schedules", json={**body, "task_id": theirs["id"]}).status_code == 201
    assert client.delete(f"/api/schedules/{second.json()['id']}").status_code == 204
    assert client.delete(f"/api/tasks/{item['id']}").status_code == 204
    assert client.get("/api/schedules").json() == []


def test_invalid_scheduling(client, user):
    item = task(client, status="completed")
    body = {"task_id": item["id"], "start_at": "2030-01-01T10:00:00Z", "end_at": "2030-01-01T11:00:00Z"}
    assert client.post("/api/schedules", json=body).status_code == 409
    assert client.post("/api/schedules", json={**body, "end_at": body["start_at"]}).status_code == 422
    assert client.post("/api/schedules", json={**body, "task_id": str(uuid4())}).status_code == 404


def test_notifications_deduplicate_and_preferences(client, user):
    item = task(client, due_at=(utcnow() - timedelta(hours=1)).isoformat())
    first = client.get("/api/notifications").json()
    assert len(first) == 1
    assert client.get("/api/notifications").json() == first
    response = client.patch(f"/api/notifications/{first[0]['id']}", json={"read": True})
    assert response.json()["read"] is True
    client.patch("/api/auth/me", json={"notifications_enabled": False})
    task(client, title="Another overdue", due_at=(utcnow() - timedelta(hours=1)).isoformat())
    assert len(client.get("/api/notifications").json()) == 1
    client.patch("/api/auth/me", json={"notifications_enabled": True})
    assert len(client.get("/api/notifications").json()) == 2
    client.delete(f"/api/tasks/{item['id']}")
    assert len(client.get("/api/notifications").json()) == 1


def test_unauthenticated_and_body_limit(client):
    for route in ("tasks", "projects", "notes", "schedules", "notifications", "analytics", "auth/me"):
        assert client.get("/api/" + route).status_code == 401
    assert client.post("/api/auth/login", content="x" * 262145).status_code == 413


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/health").status_code == 200
