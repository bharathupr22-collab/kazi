from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response

from app.core.security import current_user
from app.db.mongo import get_db, session_kw, transaction
from app.schemas.entities import NoteCreate, NotePatch, NotificationPatch, ProjectCreate, ProjectPatch, ScheduleCreate, SchedulePatch, TaskCreate, TaskPatch, new_id, utcnow
from app.services.entities import PROJECT_FIELDS, TASK_FIELDS, activity, clean, create_schedule, create_task, owned, project_view, schedule_check, serialize_user_write, validate_merged

router = APIRouter(tags=["productivity"])


@router.get("/tasks")
def tasks(user=Depends(current_user), db=Depends(get_db)):
    return [clean(item) for item in db.tasks.find({"user_id": user["id"]}).sort("created_at", -1)]


@router.post("/tasks", status_code=201)
def add_task(body: TaskCreate, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        return create_task(db, user["id"], body, session)


@router.patch("/tasks/{task_id}")
def edit_task(task_id: str, body: TaskPatch, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        kw = session_kw(session)
        serialize_user_write(db, user["id"], session)
        old = owned(db, "tasks", user["id"], task_id, session)
        merged = validate_merged(TaskCreate, {**{k: old[k] for k in TASK_FIELDS}, **body.model_dump(exclude_unset=True)})
        if merged.project_id:
            owned(db, "projects", user["id"], merged.project_id, session)
        changes = {**merged.model_dump(), "updated_at": utcnow(), "version": old.get("version", 0) + 1}
        if old["status"] != merged.status:
            changes["completed_at"] = utcnow() if merged.status == "completed" else None
            if merged.status == "completed" or old["status"] == "completed":
                activity(db, user["id"], {**old, **changes}, "completed" if merged.status == "completed" else "reopened", session)
        db.tasks.update_one({"id": old["id"], "user_id": user["id"]}, {"$set": changes}, **kw)
        return clean({**old, **changes})


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        kw = session_kw(session)
        serialize_user_write(db, user["id"], session)
        task = owned(db, "tasks", user["id"], task_id, session)
        query = {"user_id": user["id"], "task_id": task["id"]}
        db.schedules.delete_many(query, **kw)
        db.notifications.delete_many(query, **kw)
        db.tasks.delete_one({"user_id": user["id"], "id": task["id"]}, **kw)
    return Response(status_code=204)


@router.get("/projects")
def projects(user=Depends(current_user), db=Depends(get_db)):
    return [project_view(db, user["id"], item) for item in db.projects.find({"user_id": user["id"]}).sort("created_at", -1)]


@router.post("/projects", status_code=201)
def add_project(body: ProjectCreate, request: Request, user=Depends(current_user), db=Depends(get_db)):
    now = utcnow()
    item = {**body.model_dump(), "id": new_id(), "user_id": user["id"], "created_at": now, "updated_at": now}
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        db.projects.insert_one(item, **session_kw(session))
    return {**clean(item), "task_count": 0, "completed_count": 0, "progress": 0}


@router.patch("/projects/{project_id}")
def edit_project(project_id: str, body: ProjectPatch, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        old = owned(db, "projects", user["id"], project_id, session)
        merged = validate_merged(ProjectCreate, {**{k: old[k] for k in PROJECT_FIELDS}, **body.model_dump(exclude_unset=True)})
        changes = {**merged.model_dump(), "updated_at": utcnow()}
        db.projects.update_one({"id": old["id"], "user_id": user["id"]}, {"$set": changes}, **session_kw(session))
    return project_view(db, user["id"], {**old, **changes})


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        kw = session_kw(session)
        serialize_user_write(db, user["id"], session)
        project = owned(db, "projects", user["id"], project_id, session)
        # Preserve tasks; detach their foreign key rather than destroying user data.
        db.tasks.update_many({"user_id": user["id"], "project_id": project["id"]}, {"$set": {"project_id": None, "updated_at": utcnow()}, "$inc": {"version": 1}}, **kw)
        db.notifications.delete_many({"user_id": user["id"], "project_id": project["id"]}, **kw)
        db.projects.delete_one({"id": project["id"], "user_id": user["id"]}, **kw)
    return Response(status_code=204)


@router.get("/notes")
def notes(user=Depends(current_user), db=Depends(get_db)):
    return [clean(item) for item in db.notes.find({"user_id": user["id"]}).sort("updated_at", -1)]


@router.post("/notes", status_code=201)
def add_note(body: NoteCreate, request: Request, user=Depends(current_user), db=Depends(get_db)):
    now = utcnow()
    item = {**body.model_dump(), "id": new_id(), "user_id": user["id"], "created_at": now, "updated_at": now}
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        db.notes.insert_one(item, **session_kw(session))
    return clean(item)


@router.patch("/notes/{note_id}")
def edit_note(note_id: str, body: NotePatch, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        old = owned(db, "notes", user["id"], note_id, session)
        changes = {**body.model_dump(exclude_unset=True), "updated_at": utcnow()}
        db.notes.update_one({"id": old["id"], "user_id": user["id"]}, {"$set": changes}, **session_kw(session))
    return clean({**old, **changes})


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        old = owned(db, "notes", user["id"], note_id, session)
        db.notes.delete_one({"id": old["id"], "user_id": user["id"]}, **session_kw(session))
    return Response(status_code=204)


@router.get("/schedules")
def schedules(user=Depends(current_user), db=Depends(get_db)):
    result = []
    for item in db.schedules.find({"user_id": user["id"]}).sort("start_at", 1):
        task = owned(db, "tasks", user["id"], item["task_id"])
        result.append({**clean(item), "task_title": task["title"]})
    return result


@router.post("/schedules", status_code=201)
def add_schedule(body: ScheduleCreate, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        return create_schedule(db, user["id"], body, session)


@router.patch("/schedules/{schedule_id}")
def edit_schedule(schedule_id: str, body: SchedulePatch, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        old = owned(db, "schedules", user["id"], schedule_id, session)
        data = ScheduleCreate(task_id=old["task_id"], **body.model_dump())
        task = schedule_check(db, user["id"], data, exclude=old["id"], session=session)
        db.schedules.update_one({"id": old["id"], "user_id": user["id"]}, {"$set": body.model_dump()}, **session_kw(session))
    return {**clean(old), **body.model_dump(), "task_title": task["title"]}


@router.delete("/schedules/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    with transaction(request) as session:
        serialize_user_write(db, user["id"], session)
        old = owned(db, "schedules", user["id"], schedule_id, session)
        db.schedules.delete_one({"id": old["id"], "user_id": user["id"]}, **session_kw(session))
    return Response(status_code=204)


def scan_notifications(db, user):
    if not user["notifications_enabled"]:
        return
    now = utcnow()

    def notify(key, title, message, **references):
        query = {"user_id": user["id"], "event_key": key}
        db.notifications.update_one(query, {"$setOnInsert": {
            "id": new_id(), **references, "title": title, "message": message,
            "read": False, "created_at": now,
        }}, upsert=True)

    for task in db.tasks.find({"user_id": user["id"], "status": {"$ne": "completed"}, "due_at": {"$ne": None}}):
        due = task["due_at"]
        reminder = task.get("reminder_minutes")
        if due <= now:
            kind, title = "overdue", "Task overdue"
        elif reminder is not None and due - timedelta(minutes=reminder) <= now:
            kind, title = "reminder", "Task reminder"
        else:
            continue
        key = f"{task['id']}:{kind}:{due.isoformat()}"
        notify(key, title, f"{task['title']} is due at {due.isoformat()}", task_id=task["id"])

    for project in db.projects.find({"user_id": user["id"], "status": {"$ne": "completed"}, "deadline": {"$ne": None, "$lte": now + timedelta(hours=24)}}):
        deadline = project["deadline"]
        kind, title = ("overdue", "Project overdue") if deadline <= now else ("reminder", "Project deadline approaching")
        notify(f"project:{project['id']}:{kind}:{deadline.isoformat()}", title,
               f"{project['name']} has a deadline at {deadline.isoformat()}", project_id=project["id"])

    for schedule in db.schedules.find({"user_id": user["id"], "start_at": {"$lte": now + timedelta(minutes=15)}, "end_at": {"$gt": now}}):
        task = db.tasks.find_one({"user_id": user["id"], "id": schedule["task_id"], "status": {"$ne": "completed"}})
        if not task:
            continue
        start = schedule["start_at"]
        kind, title = ("started", "Scheduled activity started") if start <= now else ("reminder", "Scheduled activity approaching")
        notify(f"schedule:{schedule['id']}:{kind}:{start.isoformat()}", title,
               f"{task['title']} is scheduled at {start.isoformat()}", task_id=task["id"], schedule_id=schedule["id"])


def notification_view(item):
    return {k: item[k] for k in ("id", "title", "message", "read", "created_at")}


@router.get("/notifications")
def notifications(user=Depends(current_user), db=Depends(get_db)):
    scan_notifications(db, user)
    return [notification_view(item) for item in db.notifications.find({"user_id": user["id"]}).sort("created_at", -1)]


@router.patch("/notifications/{notification_id}")
def edit_notification(notification_id: str, body: NotificationPatch, user=Depends(current_user), db=Depends(get_db)):
    old = owned(db, "notifications", user["id"], notification_id)
    db.notifications.update_one({"id": old["id"], "user_id": user["id"]}, {"$set": {"read": body.read}})
    return notification_view({**old, "read": body.read})
