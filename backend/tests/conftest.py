from contextlib import contextmanager
from copy import deepcopy
from threading import RLock

import mongomock
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

ORIGIN = {"Origin": "http://localhost:3000"}
PASSWORD = "a strong password 123"


@pytest.fixture
def db():
    return mongomock.MongoClient(tz_aware=True).kazi_test


@pytest.fixture
def app(db):
    lock = RLock()

    @contextmanager
    def test_transaction():
        # Mongomock cannot run Mongo transactions. This adapter supplies rollback
        # for offline behavior tests, not a simulation of Mongo concurrency.
        with lock:
            snapshot = {name: deepcopy(list(db[name].find())) for name in db.list_collection_names()}
            try:
                yield None
            except BaseException:
                for name in db.list_collection_names():
                    db[name].delete_many({})
                    if snapshot.get(name):
                        db[name].insert_many(snapshot[name])
                raise

    settings = Settings(_env_file=None, environment="test", frontend_origin="http://localhost:3000",
                        cookie_secure=False, openai_api_key="test-server-only-key", auth_rate_limit=100, smtp_host="smtp.invalid")
    return create_app(settings, database=db, transaction_factory=test_transaction)


@pytest.fixture
def client(app):
    with TestClient(app, headers=ORIGIN) as client:
        yield client


@pytest.fixture
def user(client):
    response = client.post("/api/auth/register", json={"name": "Alice", "email": "alice@example.com", "password": PASSWORD})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def other(app, user):
    client = TestClient(app, headers=ORIGIN)
    response = client.post("/api/auth/register", json={"name": "Bob", "email": "bob@example.com", "password": PASSWORD})
    assert response.status_code == 201, response.text
    yield client
    client.close()


def task(client, **kwargs):
    response = client.post("/api/tasks", json={"title": "Write report", **kwargs})
    assert response.status_code == 201, response.text
    return response.json()
