from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.api import auth
from app.core.security import digest
from app.schemas.entities import utcnow
from conftest import PASSWORD


def test_auth_lifecycle(client, user, db):
    cookie = client.cookies.get("kazi_session")
    session = db.sessions.find_one({"user_id": user["id"]})
    assert session["token_hash"] == digest(cookie)
    assert cookie not in str(session)
    record = db.users.find_one({"id": user["id"]})
    assert record["password_hash"].startswith("$argon2id$")
    assert "password" not in user and "password_hash" not in user
    assert client.get("/api/auth/me").json() == user
    response = client.patch("/api/auth/me", json={"name": "Alicia", "timezone": "Asia/Kolkata", "notifications_enabled": False})
    assert response.json()["name"] == "Alicia"
    assert response.json()["timezone"] == "Asia/Kolkata"
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    response = client.post("/api/auth/login", json={"email": "ALICE@example.com", "password": PASSWORD})
    assert response.status_code == 200
    assert client.cookies.get("kazi_session") != cookie
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]


def test_bad_auth_and_duplicate(client, user):
    assert client.post("/api/auth/register", json={"name": "A", "email": user["email"], "password": PASSWORD}).status_code == 409
    for email in (user["email"], "missing@example.com"):
        response = client.post("/api/auth/login", json={"email": email, "password": "incorrect"})
        assert response.status_code == 401
        assert response.json() == {"detail": "Invalid email or password"}


def test_expired_session_is_rejected(client, user, db):
    db.sessions.update_many({}, {"$set": {"expires_at": utcnow() - timedelta(seconds=1)}})
    assert client.get("/api/auth/me").status_code == 401


def test_csrf_origin_and_no_origin(client, user):
    assert client.post("/api/auth/logout", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.patch("/api/auth/me", json={"name": "X"}, headers={"Origin": "null"}).status_code == 403
    del client.headers["Origin"]
    assert client.post("/api/auth/logout").status_code == 403
    assert client.post("/api/auth/logout", headers={"Referer": "http://[malformed"}).status_code == 403
    assert client.post("/api/auth/logout", headers={"Referer": "http://localhost:3000/settings"}).status_code == 204


def test_rate_limit(app, client):
    app.state.settings.auth_rate_limit = 2
    for _ in range(2):
        assert client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "bad"}).status_code == 401
    response = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "bad"})
    assert response.status_code == 429
    assert "Retry-After" in response.headers


def test_reset_only_email_one_time_and_revokes_sessions(client, user, db, monkeypatch):
    sent = []
    monkeypatch.setattr(auth, "send_reset", lambda settings, email, token: sent.append((email, token)))
    response = client.post("/api/auth/forgot-password", json={"email": user["email"]})
    generic = response.json()
    token = sent[0][1]
    assert response.status_code == 200 and token not in response.text
    record = db.password_resets.find_one({"user_id": user["id"]})
    assert record["token_hash"] == digest(token) and token not in str(record)
    assert client.post("/api/auth/forgot-password", json={"email": "unknown@example.com"}).json() == generic
    response = client.post("/api/auth/reset-password", json={"token": token, "password": "my new password 456"})
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "another password 789"}).status_code == 400
    assert client.post("/api/auth/login", json={"email": user["email"], "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/login", json={"email": user["email"], "password": "my new password 456"}).status_code == 200


def test_smtp_configuration_and_failure(client, user, app, monkeypatch, db):
    app.state.settings.smtp_host = None
    assert client.post("/api/auth/forgot-password", json={"email": user["email"]}).status_code == 503
    app.state.settings.smtp_host = "smtp.invalid"

    def fail(*args):
        raise OSError("private secret error")

    monkeypatch.setattr(auth, "send_reset", fail)
    response = client.post("/api/auth/forgot-password", json={"email": user["email"]})
    assert response.status_code == 503 and "secret" not in response.text
    assert db.password_resets.count_documents({}) == 0


@pytest.mark.parametrize("changes", [{"name": None}, {"timezone": "No/Such_Zone"}, {"admin": True}, {"name": " "}])
def test_profile_validation(client, user, changes):
    response = client.patch("/api/auth/me", json=changes)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_login_rehash_cannot_restore_password_after_concurrent_reset(client, user, db, monkeypatch):
    sent = []
    monkeypatch.setattr(auth, "send_reset", lambda settings, email, token: sent.append(token))
    assert client.post("/api/auth/forgot-password", json={"email": user["email"]}).status_code == 200
    new_password = "new password after concurrent reset"
    original_verify = auth.verify_password

    def reset_after_verify(encoded, password):
        valid = original_verify(encoded, password)
        if valid:
            response = client.post("/api/auth/reset-password", json={"token": sent[0], "password": new_password})
            assert response.status_code == 200
        return valid

    with monkeypatch.context() as patch:
        patch.setattr(auth, "verify_password", reset_after_verify)
        patch.setattr(auth, "hasher", SimpleNamespace(
            check_needs_rehash=lambda encoded: True, hash=auth.hasher.hash,
        ))
        response = client.post("/api/auth/login", json={"email": user["email"], "password": PASSWORD})
        assert response.status_code == 401
    record = db.users.find_one({"id": user["id"]})
    assert not original_verify(record["password_hash"], PASSWORD)
    assert original_verify(record["password_hash"], new_password)
    assert client.post("/api/auth/login", json={"email": user["email"], "password": new_password}).status_code == 200


def test_password_whitespace_is_significant(client):
    password = "  spaced password  "
    response = client.post("/api/auth/register", json={"name": " Space ", "email": "space@example.com", "password": password})
    assert response.status_code == 201
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json={"email": "space@example.com", "password": password.strip()}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "space@example.com", "password": password}).status_code == 200
