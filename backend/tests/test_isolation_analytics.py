from datetime import timedelta

from app.schemas.entities import utcnow
from conftest import task


def test_every_collection_and_foreign_key_is_owned(client, user, other):
    project = client.post("/api/projects", json={"name": "Private project"}).json()
    item = task(client, project_id=project["id"], due_at=(utcnow() - timedelta(hours=1)).isoformat())
    note = client.post("/api/notes", json={"title": "Private note", "content": "Private"}).json()
    schedule = client.post("/api/schedules", json={"task_id": item["id"], "start_at": "2030-01-01T10:00:00Z", "end_at": "2030-01-01T11:00:00Z"}).json()
    notification = client.get("/api/notifications").json()[0]
    for route, entity, change in (
        ("tasks", item, {"title": "Stolen"}), ("projects", project, {"name": "Stolen"}),
        ("notes", note, {"content": "Stolen"}),
        ("schedules", schedule, {"start_at": "2030-01-01T12:00:00Z", "end_at": "2030-01-01T13:00:00Z"}),
    ):
        assert other.get(f"/api/{route}").json() == []
        assert other.patch(f"/api/{route}/{entity['id']}", json=change).status_code == 404
        assert other.delete(f"/api/{route}/{entity['id']}").status_code == 404
    assert other.patch(f"/api/notifications/{notification['id']}", json={"read": True}).status_code == 404
    assert other.get("/api/notifications").json() == []
    assert other.post(f"/api/notes/{note['id']}/convert").status_code == 404
    assert other.post("/api/tasks", json={"title": "Cross reference", "project_id": project["id"]}).status_code == 404
    their_task = task(other)
    assert other.patch(f"/api/tasks/{their_task['id']}", json={"project_id": project["id"]}).status_code == 404
    assert other.post("/api/schedules", json={"task_id": item["id"], "start_at": "2030-01-01T10:00:00Z", "end_at": "2030-01-01T11:00:00Z"}).status_code == 404
    assert other.get("/api/analytics").json()["overdue"] == 0


def test_analytics_uses_completion_events_and_own_data(client, user, other):
    empty = client.get("/api/analytics").json()
    assert empty["total"] == 0 and empty["completion_rate"] == 0
    assert len(empty["weekly"]) == 7 and all(day["completed"] == 0 for day in empty["weekly"])
    project = client.post("/api/projects", json={"name": "Measured"}).json()
    item = task(client, actual_minutes=25, project_id=project["id"])
    task(client, due_at=(utcnow() - timedelta(days=1)).isoformat())
    task(other, status="completed", actual_minutes=999)
    client.patch(f"/api/tasks/{item['id']}", json={"status": "completed"})
    client.patch(f"/api/tasks/{item['id']}", json={"status": "completed"})
    result = client.get("/api/analytics").json()
    assert (result["total"], result["completed"], result["pending"], result["overdue"], result["total_minutes"]) == (2, 1, 1, 1, 25)
    assert result["completion_rate"] == 50
    assert sum(day["completed"] for day in result["weekly"]) == 1
    assert result["projects"][0]["progress"] == 100
    client.patch(f"/api/tasks/{item['id']}", json={"status": "todo"})
    result = client.get("/api/analytics").json()
    assert result["completed"] == 0
    assert sum(day["completed"] for day in result["weekly"]) == 1
    client.patch(f"/api/tasks/{item['id']}", json={"status": "completed"})
    assert sum(day["completed"] for day in client.get("/api/analytics").json()["weekly"]) == 1
    client.delete(f"/api/tasks/{item['id']}")
    assert sum(day["completed"] for day in client.get("/api/analytics").json()["weekly"]) == 1
