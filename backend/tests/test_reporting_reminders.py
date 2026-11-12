from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.api import resources
from app.schemas.entities import new_id
from app.services import analytics
from conftest import task


NOW = datetime(2030, 5, 15, 12, tzinfo=timezone.utc)


@pytest.fixture
def clock(monkeypatch):
    monkeypatch.setattr(resources, "utcnow", lambda: NOW)
    monkeypatch.setattr(analytics, "utcnow", lambda: NOW)
    return NOW


def project(client, **values):
    response = client.post("/api/projects", json={"name": "Launch", **values})
    assert response.status_code == 201, response.text
    return response.json()


def schedule(client, item, start, end):
    response = client.post("/api/schedules", json={
        "task_id": item["id"], "start_at": start.isoformat(), "end_at": end.isoformat(),
    })
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("zone_name", ["Asia/Kathmandu", "America/Los_Angeles", "Pacific/Kiritimati"])
def test_reporting_real_events_local_hour_and_month_boundaries(client, user, other, db, clock, zone_name):
    assert client.patch("/api/auth/me", json={"timezone": zone_name}).status_code == 200
    zone = ZoneInfo(zone_name)
    local_now = clock.astimezone(zone)
    midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    first = midnight - timedelta(days=29)
    item = task(client)
    # A real status transition records the event; reopening/deleting keeps history.
    client.patch(f"/api/tasks/{item['id']}", json={"status": "completed"})
    db.activity.update_one({"task_id": item["id"], "event": "completed"}, {"$set": {"occurred_at": clock}})
    client.patch(f"/api/tasks/{item['id']}", json={"status": "todo"})
    client.delete(f"/api/tasks/{item['id']}")
    events = [
        (item["id"], clock, "completed"),
        ("earlier-hour", midnight + timedelta(hours=1), "completed"),
        ("yesterday", midnight - timedelta(milliseconds=1), "completed"),
        ("month-start", first, "completed"),
        ("too-old", first - timedelta(milliseconds=1), "completed"),
        ("future", clock + timedelta(days=1), "completed"),
        ("not-completed", clock, "reopened"),
    ]
    for task_id, stamp, event in events:
        db.activity.insert_one({"id": new_id(), "user_id": user["id"], "task_id": task_id, "occurred_at": stamp, "event": event})
    db.activity.insert_one({"id": new_id(), "user_id": other.get("/api/auth/me").json()["id"], "task_id": "private", "occurred_at": clock, "event": "completed"})
    result = client.get("/api/analytics").json()
    assert result["total"] == 0 and result["completed"] == 0
    assert len(result["daily"]) == 24
    assert [p["hour"] for p in result["daily"]] == [f"{h:02d}:00" for h in range(24)]
    assert result["daily"][local_now.hour]["completed"] == 1
    assert result["daily"][1]["completed"] == 1
    assert sum(p["completed"] for p in result["daily"]) == 2
    assert len(result["monthly"]) == 30
    assert result["monthly"][0] == {"date": first.date().isoformat(), "completed": 1}
    assert result["monthly"][-2]["completed"] == 1
    assert result["monthly"][-1] == {"date": local_now.date().isoformat(), "completed": 2}
    assert sum(p["completed"] for p in result["monthly"]) == 4
    # Preserve the existing weekly algorithm and output exactly.
    days = [local_now.date() - timedelta(days=i) for i in reversed(range(7))]
    buckets = {day: set() for day in days}
    for event in db.activity.find({"user_id": user["id"], "event": "completed", "occurred_at": {"$gte": clock - timedelta(days=8)}}):
        day = event["occurred_at"].astimezone(zone).date()
        if day in buckets:
            buckets[day].add(event["task_id"])
    assert result["weekly"] == [{"date": day.isoformat(), "completed": len(buckets[day])} for day in days]


@pytest.mark.parametrize("stamp", ["2030-03-10T12:00:00+00:00", "2030-11-03T12:00:00+00:00"])
def test_reporting_dst_always_has_24_wall_clock_hours(client, user, db, monkeypatch, stamp):
    now = datetime.fromisoformat(stamp)
    monkeypatch.setattr(analytics, "utcnow", lambda: now)
    client.patch("/api/auth/me", json={"timezone": "America/New_York"})
    # On fall-back day both instants are local 01:30; on spring-forward day
    # they are 00:30 and 01:30, leaving the nonexistent 02:00 bucket empty.
    for hour in (5, 6):
        db.activity.insert_one({"id": new_id(), "user_id": user["id"], "task_id": str(hour), "event": "completed", "occurred_at": now.replace(hour=hour, minute=30)})
    result = client.get("/api/analytics").json()
    assert len(result["daily"]) == 24
    assert sum(p["completed"] for p in result["daily"]) == 2
    assert result["daily"][2]["completed"] == 0
    if now.month == 11:
        assert result["daily"][1]["completed"] == 2
    assert result["monthly"][-1]["completed"] == 2


def test_project_reminders_boundaries_dedup_and_changed_deadline(client, user, db, clock, monkeypatch):
    due = clock + timedelta(hours=24)
    upcoming = project(client, deadline=due.isoformat())
    project(client, name="Overdue", deadline=clock.isoformat())
    project(client, name="Later", deadline=(due + timedelta(seconds=1)).isoformat())
    project(client, name="Done", status="completed", deadline=(clock - timedelta(days=1)).isoformat())
    project(client, name="No deadline")
    first = client.get("/api/notifications").json()
    assert {n["title"] for n in first} == {"Project deadline approaching", "Project overdue"}
    assert len(first) == 2
    assert all(set(n) == {"id", "title", "message", "read", "created_at"} for n in first)
    client.patch(f"/api/notifications/{first[0]['id']}", json={"read": True})
    assert len(client.get("/api/notifications").json()) == 2
    assert client.get("/api/notifications").json()[0]["read"] is True
    client.patch(f"/api/projects/{upcoming['id']}", json={"deadline": (clock + timedelta(hours=23)).isoformat()})
    assert len(client.get("/api/notifications").json()) == 3
    monkeypatch.setattr(resources, "utcnow", lambda: clock + timedelta(hours=23))
    client.get("/api/notifications")
    assert db.notifications.count_documents({"project_id": upcoming["id"]}) == 3
    assert client.get("/api/notifications").status_code == 200
    assert db.notifications.count_documents({"project_id": upcoming["id"]}) == 3


def test_schedule_reminders_started_reschedule_and_task_cascade(client, user, db, clock, monkeypatch):
    item = task(client)
    start = clock + timedelta(minutes=15)
    block = schedule(client, item, start, start + timedelta(hours=1))
    first = client.get("/api/notifications").json()
    assert len(first) == 1 and first[0]["title"] == "Scheduled activity approaching"
    assert client.get("/api/notifications").json() == first
    monkeypatch.setattr(resources, "utcnow", lambda: start)
    assert len(client.get("/api/notifications").json()) == 2
    assert {n["title"] for n in client.get("/api/notifications").json()} == {"Scheduled activity approaching", "Scheduled activity started"}
    moved = start + timedelta(minutes=10)
    assert client.patch(f"/api/schedules/{block['id']}", json={"start_at": moved.isoformat(), "end_at": (moved + timedelta(hours=1)).isoformat()}).status_code == 200
    assert len(client.get("/api/notifications").json()) == 3
    assert len(client.get("/api/notifications").json()) == 3
    assert client.delete(f"/api/tasks/{item['id']}").status_code == 204
    assert db.schedules.count_documents({"task_id": item["id"]}) == 0
    assert db.notifications.count_documents({"task_id": item["id"]}) == 0


def test_schedule_skips_finished_future_completed_and_foreign_tasks(client, user, other, db, clock):
    item = task(client)
    schedule(client, item, clock - timedelta(hours=2), clock - timedelta(hours=1))
    schedule(client, item, clock - timedelta(minutes=30), clock)
    schedule(client, item, clock + timedelta(minutes=15, seconds=1), clock + timedelta(hours=1))
    done = task(client)
    schedule(client, done, clock, clock + timedelta(minutes=10))
    client.patch(f"/api/tasks/{done['id']}", json={"status": "completed"})
    foreign = task(other)
    db.schedules.insert_one({"id": "invalid-foreign-reference", "user_id": user["id"], "task_id": foreign["id"], "start_at": clock, "end_at": clock + timedelta(hours=1)})
    assert client.get("/api/notifications").json() == []
    assert other.get("/api/notifications").json() == []


def test_schedule_in_progress_is_reported_on_late_scan(client, user, clock):
    item = task(client)
    schedule(client, item, clock - timedelta(minutes=10), clock + timedelta(minutes=5))
    assert [n["title"] for n in client.get("/api/notifications").json()] == ["Scheduled activity started"]


def test_all_reminders_preferences_and_owner_isolation(client, user, other, db, clock):
    own_project = project(client, deadline=clock.isoformat())
    own_task = task(client, due_at=clock.isoformat())
    schedule(client, own_task, clock, clock + timedelta(hours=1))
    project(other, deadline=clock.isoformat())
    foreign_task = task(other, due_at=clock.isoformat())
    schedule(other, foreign_task, clock, clock + timedelta(hours=1))
    client.patch("/api/auth/me", json={"notifications_enabled": False})
    assert client.get("/api/notifications").json() == []
    theirs = other.get("/api/notifications").json()
    assert len(theirs) == 3
    client.patch("/api/auth/me", json={"notifications_enabled": True})
    ours = client.get("/api/notifications").json()
    assert len(ours) == 3
    assert {n["id"] for n in ours}.isdisjoint(n["id"] for n in theirs)
    # Even an identical event key is deduplicated by owner, never globally.
    key = db.notifications.find_one({"project_id": own_project["id"]})["event_key"]
    db.notifications.insert_one({"id": "foreign-same-key", "user_id": other.get("/api/auth/me").json()["id"], "event_key": key, "project_id": own_project["id"], "title": "Foreign", "message": "Private", "read": False, "created_at": clock})
    assert len(client.get("/api/notifications").json()) == 3
    assert other.patch(f"/api/notifications/{ours[0]['id']}", json={"read": True}).status_code == 404
    assert client.delete(f"/api/projects/{own_project['id']}").status_code == 204
    assert db.notifications.count_documents({"user_id": user["id"], "project_id": own_project["id"]}) == 0
    assert db.notifications.count_documents({"id": "foreign-same-key"}) == 1
    assert len(client.get("/api/notifications").json()) == 2
    assert len(other.get("/api/notifications").json()) == 4
    assert client.get("/api/tasks").json()[0]["project_id"] is None


def test_project_notification_cleanup_rolls_back_with_delete(client, user, db, clock, monkeypatch):
    item = project(client, deadline=clock.isoformat())
    attached = task(client, project_id=item["id"])
    before = client.get("/api/notifications").json()

    def fail_delete(*args, **kwargs):
        raise RuntimeError("Injected project deletion failure")

    monkeypatch.setattr(db.projects, "delete_one", fail_delete)
    with pytest.raises(RuntimeError, match="Injected project deletion failure"):
        client.delete(f"/api/projects/{item['id']}")
    assert db.projects.count_documents({"id": item["id"]}) == 1
    assert db.tasks.find_one({"id": attached["id"]})["project_id"] == item["id"]
    assert client.get("/api/notifications").json() == before
