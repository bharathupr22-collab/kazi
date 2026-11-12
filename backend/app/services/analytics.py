from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.schemas.entities import utcnow
from app.services.entities import project_view


def build_analytics(db, user):
    now = utcnow()
    zone = ZoneInfo(user["timezone"])
    today = now.astimezone(zone).date()
    days = [today - timedelta(days=i) for i in reversed(range(7))]
    tasks = list(db.tasks.find({"user_id": user["id"]}))
    completed = sum(task["status"] == "completed" for task in tasks)
    overdue = sum(task["status"] != "completed" and task["due_at"] is not None and task["due_at"] < now for task in tasks)
    # Count real completion transitions, once per task per local calendar day.
    # History is retained even if a task is later reopened or deleted.
    buckets = {day: set() for day in days}
    events = db.activity.find({"user_id": user["id"], "event": "completed", "occurred_at": {"$gte": now - timedelta(days=8)}})
    for event in events:
        day = event["occurred_at"].astimezone(zone).date()
        if day in buckets:
            buckets[day].add(event["task_id"])
    month_days = [today - timedelta(days=i) for i in reversed(range(30))]
    month_buckets = {day: set() for day in month_days}
    hour_buckets = {hour: set() for hour in range(24)}
    month_start = datetime.combine(month_days[0], time.min, tzinfo=zone).astimezone(timezone.utc)
    recent_events = db.activity.find({"user_id": user["id"], "event": "completed", "occurred_at": {"$gte": month_start, "$lte": now}})
    for event in recent_events:
        local = event["occurred_at"].astimezone(zone)
        if local.date() in month_buckets:
            month_buckets[local.date()].add(event["task_id"])
        if local.date() == today:
            # Keep 24 wall-clock buckets even on DST days; repeated hours merge.
            hour_buckets[local.hour].add(event["task_id"])
    daily = [{"hour": f"{hour:02d}:00", "completed": len(hour_buckets[hour])} for hour in range(24)]
    monthly = [{"date": day.isoformat(), "completed": len(month_buckets[day])} for day in month_days]
    projects = [project_view(db, user["id"], project) for project in db.projects.find({"user_id": user["id"]})]
    weekly = [{"date": day.isoformat(), "completed": len(buckets[day])} for day in days]
    minutes = sum(task["actual_minutes"] for task in tasks)
    insights = [f"{sum(item['completed'] for item in weekly)} recorded task completions in the last seven days."]
    if overdue:
        insights.append(f"{overdue} unfinished tasks are overdue.")
    if not tasks:
        insights.append("Create your first task to start tracking progress.")
    return {
        "total": len(tasks), "completed": completed, "pending": len(tasks) - completed,
        "overdue": overdue, "completion_rate": round(completed / len(tasks) * 100, 2) if tasks else 0,
        "total_minutes": minutes, "weekly": weekly, "daily": daily, "monthly": monthly,
        "projects": [{"id": p["id"], "name": p["name"], "progress": p["progress"]} for p in projects], "insights": insights,
    }
