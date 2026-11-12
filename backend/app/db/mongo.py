from contextlib import contextmanager

from fastapi import HTTPException, Request
from pymongo import ASCENDING, MongoClient
from pymongo.errors import ConfigurationError, OperationFailure
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

from app.core.config import Settings


def connect(settings: Settings):
    client = MongoClient(settings.mongo_uri, tz_aware=True, serverSelectionTimeoutMS=5000,
                             connectTimeoutMS=5000, socketTimeoutMS=15000)
    return client, client[settings.mongo_database]


def indexes(db):
    db.users.create_index("email", unique=True)
    for name in ("users", "tasks", "projects", "notes", "schedules", "notifications", "proposals", "activity"):
        db[name].create_index("id", unique=True)
    for name in ("tasks", "projects", "notes", "schedules", "notifications", "proposals", "activity"):
        db[name].create_index([("user_id", ASCENDING), ("id", ASCENDING)], unique=True)
    db.tasks.create_index([("user_id", 1), ("project_id", 1)])
    db.schedules.create_index([("user_id", 1), ("start_at", 1), ("end_at", 1)])
    db.sessions.create_index("token_hash", unique=True)
    db.sessions.create_index("expires_at", expireAfterSeconds=0)
    db.sessions.create_index("user_id")
    db.password_resets.create_index("token_hash", unique=True)
    db.password_resets.create_index("expires_at", expireAfterSeconds=0)
    db.password_resets.create_index("user_id", unique=True)
    db.notifications.create_index([("user_id", 1), ("event_key", 1)], unique=True)
    db.activity.create_index([("user_id", 1), ("occurred_at", 1)])
    db.tasks.create_index([("user_id", 1), ("operation_id", 1)], unique=True, partialFilterExpression={"operation_id": {"$type": "string"}})
    db.schedules.create_index([("user_id", 1), ("operation_id", 1)], unique=True, partialFilterExpression={"operation_id": {"$type": "string"}})
    db.proposals.create_index("expires_at", expireAfterSeconds=0)


def get_db(request: Request):
    return request.app.state.db


@contextmanager
def transaction(request: Request):
    """Production always uses a real Mongo transaction; tests inject an isolated adapter."""
    adapter = getattr(request.app.state, "transaction_factory", None)
    if adapter:
        with adapter() as session:
            yield session
        return
    try:
        with request.app.state.mongo_client.start_session() as session:
            with session.start_transaction(read_concern=ReadConcern("snapshot"),
                                                       write_concern=WriteConcern("majority"), max_commit_time_ms=10000):
                yield session
    except (ConfigurationError, OperationFailure) as exc:
        if isinstance(exc, ConfigurationError) or exc.code in {20, 303}:
            raise HTTPException(503, "This operation requires MongoDB transactions. Configure a replica set; see backend/README.md.") from exc
        raise


def session_kw(session):
    return {"session": session} if session is not None else {}
