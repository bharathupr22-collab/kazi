"""Opt-in HTTP integration through the actual Next proxy, with test-only Mongo storage.

Run after `npm run build` in frontend:
KAZI_TEST_NEXT_PROXY=1 python -m pytest tests/test_next_proxy.py

This is not a real Mongo transaction test. The shared app fixture injects isolated
mongomock and its test-only rollback adapter. No application data is seeded.
"""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time

import httpx
import pytest
import uvicorn

pytestmark = pytest.mark.skipif(os.environ.get("KAZI_TEST_NEXT_PROXY") != "1", reason="Opt-in Next HTTP proxy test")
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def wait_ready(url, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise AssertionError(f"Timed out waiting for {url}")


def assert_free(port):
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            pytest.fail(f"Proxy test needs free loopback port {port}; stop the conflicting local service")


def test_registration_task_persistence_and_logout_through_next(app, db, tmp_path):
    node = shutil.which("node")
    assert node and (FRONTEND / ".next" / "BUILD_ID").exists(), "Install/build frontend before this test"
    assert_free(8000)
    assert_free(3102)
    origin = "http://localhost:3102"
    app.state.settings.frontend_origin = origin
    config = uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    process = None
    thread.start()
    try:
        wait_ready("http://127.0.0.1:8000/api/health")
        with (tmp_path / "next.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [node, str(FRONTEND / "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3102"],
                cwd=FRONTEND, stdout=log, stderr=subprocess.STDOUT,
                env={**os.environ, "NEXT_TELEMETRY_DISABLED": "1"},
            )
            wait_ready("http://127.0.0.1:3102/login")
            with httpx.Client(base_url="http://127.0.0.1:3102", headers={"Origin": origin}, timeout=15) as browser:
                assert browser.get("/api/auth/me").status_code == 401
                response = browser.post("/api/auth/register", json={"name": "Proxy Test", "email": "proxy@example.com", "password": "test proxy password 123"})
                assert response.status_code == 201, response.text
                assert "HttpOnly" in response.headers["set-cookie"]
                user = response.json()
                assert browser.get("/api/auth/me").json() == user
                created = browser.post("/api/tasks", json={"title": "Persisted through Next", "priority": "high"})
                assert created.status_code == 201, created.text
                task = created.json()
                assert db.tasks.find_one({"id": task["id"], "user_id": user["id"]})["title"] == task["title"]
                assert browser.get("/api/tasks").json()[0]["id"] == task["id"]
                moved = browser.patch(f"/api/tasks/{task['id']}", json={"status": "completed", "actual_minutes": 25})
                assert moved.status_code == 200
                report = browser.get("/api/analytics").json()
                assert report["completed"] == 1 and report["total_minutes"] == 25
                assert browser.post("/api/tasks", json={"title": "Blocked"}, headers={"Origin": "https://evil.example"}).status_code == 403
                assert browser.post("/api/auth/logout").status_code == 204
                assert browser.get("/api/auth/me").status_code == 401
                assert browser.post("/api/auth/login", json={"email": user["email"], "password": "test proxy password 123"}).status_code == 200
                assert browser.get("/api/tasks").json()[0]["status"] == "completed"
                assert browser.delete(f"/api/tasks/{task['id']}").status_code == 204
                assert browser.get("/api/tasks").json() == []
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        server.should_exit = True
        thread.join(timeout=10)
        assert not thread.is_alive(), "Test API failed to stop"
