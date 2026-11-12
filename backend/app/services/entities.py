from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError

from app.db.mongo import session_kw
from app.schemas.entities import ProjectCreate, TaskCreate, new_id, utcnow

TASK_FIELDS = set(TaskCreate.model_fields)
PROJECT_FIELDS = set(ProjectCreate.model_fields)


def valid_id(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(422, "Invalid UUID") from None


def owned(db, collection, user_id, entity_id, session=None):
    item = db[collection].find_one({"id": valid_id(entity_id), "user_id": user_id}, **session_kw(session))
    if not item:
        raise HTTPException(404, f"{collection.rstrip('s').capitalize()} not found")
    return item


def clean(item):
    return {k: v for k, v in item.items() if k not in {"_id", "user_id", "operation_id", "version"}}


def validate_merged(model, data):
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(422, "; ".join(error["msg"] for error in exc.errors())) from exc


def activity(db, user_id, task, event, session=None):
    db.activity.insert_one({
        "id": new_id(), "user_id": user_id, "task_id": task["id"],
        "event": event, "occurred_at": utcnow(), "actual_minutes": task["actual_minutes"],
    }, **session_kw(session))


def create_task(db, user_id, data: TaskCreate, session=None, operation_id=None):
    if data.project_id:
        owned(db, "projects", user_id, data.project_id, session)
    now = utcnow()
    task = {**data.model_dump(), "id": new_id(), "user_id": user_id, "created_at": now, "updated_at": now,
            "completed_at": now if data.status == "completed" else None, "version": 0}
    if operation_id:
        task["operation_id"] = operation_id
    db.tasks.insert_one(task, **session_kw(session))
    if data.status == "completed":
        activity(db, user_id, task, "completed", session)
    return clean(task)


def project_view(db, user_id, project):
    query = {"user_id": user_id, "project_id": project["id"]}
    total = db.tasks.count_documents(query)
    completed = db.tasks.count_documents({**query, "status": "completed"})
    return {**clean(project), "task_count": total, "completed_count": completed, "progress": round(completed / total * 100, 2) if total else 0}


def schedule_check(db, user_id, data, exclude=None, session=None, pending=()):
    task = owned(db, "tasks", user_id, data.task_id, session)
    if task["status"] == "completed":
        raise HTTPException(409, "This task is completed. Reopen it before scheduling.")
    query = {"user_id": user_id, "start_at": {"$lt": data.end_at}, "end_at": {"$gt": data.start_at}}
    if exclude:
        query["id"] = {"$ne": exclude}
    conflict = db.schedules.find_one(query, **session_kw(session))
    if conflict:
        raise HTTPException(409, f"Schedule conflict from {conflict['start_at'].isoformat()} to {conflict['end_at'].isoformat()}; choose a different time.")
    for other in pending:
        if other.start_at < data.end_at and other.end_at > data.start_at:
            raise HTTPException(409, "The proposal contains overlapping schedules; ask for a revised plan.")
    return task


def create_schedule(db, user_id, data, session=None, operation_id=None):
    schedule_check(db, user_id, data, session=session)
    record = {**data.model_dump(exclude={"type"}), "id": new_id(), "user_id": user_id}
    if operation_id:
        record["operation_id"] = operation_id
    db.schedules.insert_one(record, **session_kw(session))
    task = owned(db, "tasks", user_id, data.task_id, session)
    return {**clean(record), "task_title": task["title"]}


def serialize_user_write(db, user_id, session):
    # All domain writes touch this document first, so concurrent transactions
    # cannot commit against stale foreign keys or conflicting schedule snapshots.
    db.users.update_one({"id": user_id}, {"$inc": {"write_revision": 1}}, **session_kw(session))
