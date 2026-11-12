# Kazi — Your AI Productivity Partner

**Kazi** means **work** in Swahili. Spend less time organizing it and more time completing it.

A connected productivity application built with **Next.js, React, TypeScript, FastAPI, and MongoDB**. Application data starts empty: there are no seeded users, fabricated activity, or production mock-data fallbacks.

## What works

- Registration, login/logout, protected workspace, profile/timezone preferences, Argon2 password hashing, HttpOnly sessions, SMTP password reset.
- Tasks: full CRUD, priorities/statuses, dates, estimated and actual minutes, subtasks, tags, categories, project assignment, reminders, search and combined filters.
- Projects: CRUD, dates, priorities, status, and progress calculated from associated tasks. Deleting a project preserves and detaches its tasks.
- Kanban: persisted drag-and-drop and an accessible status selector.
- Calendar: day/week/month, task deadlines, create/reschedule/remove time blocks, conflict rejection. Rescheduling requires confirmation; existing blocks are never silently overwritten.
- Notes: CRUD and AI conversion into task proposals.
- AI: natural-language task proposals, task breakdown, planning existing tasks, prioritization and productivity analysis grounded in the current user's records. Review and confirm proposals before any task/schedule changes. Confirmation is transactional and safe to retry.
- Analytics: real task totals, completion rate, overdue tasks, recorded time, hourly/daily/weekly/monthly completion views, categories, project progress, and data-derived insights.
- In-app reminders: task deadlines, project deadlines, and scheduled activities, deduplicated and controlled by user preferences.
- Responsive light/dark workspace, loading/empty/error states, validation, and destructive-action confirmation.

## Prerequisites

**Docker-free development:** Node.js 22+, npm 10+, and Python 3.11+. The root launcher installs backend/frontend dependencies as needed and manages a real local MongoDB replica set with persistent on-disk storage.

**Container alternative:** Docker Desktop with Compose (Linux containers). You can also use an existing MongoDB 6+ **replica set** (MongoDB 8 recommended, or MongoDB Atlas).

A standalone `mongod` is insufficient: Kazi uses transactions to prevent partial AI confirmations and concurrent schedule conflicts. Docker Compose initializes a persistent single-node replica set automatically.

AI is optional and requires a server-side OpenAI-compatible provider key. Password reset requires SMTP. Without those settings, the relevant action returns an explicit setup error; regular task management still works.

## Quick start — no Docker required

From the project root:

```powershell
npm install
npm run dev
```

Keep that terminal open. Wait for **Kazi is ready**, then open **http://localhost:3000**. This starts the database, API (8000), and frontend (3000) together. Starting only the frontend is not sufficient: a missing API produces the reconnect screen.

**If the frontend is already running**, keep its terminal open and run this in a second terminal at the project root:

```powershell
npm run dev:backend
```

Wait for **API and database are ready**, then refresh the browser. Port conflicts produce an actionable error; the launcher does not terminate existing user services.

On first use, the launcher downloads official MongoDB 8.0.17 binaries from `fastdl.mongodb.org` and verifies the supplied checksum (Windows archive approximately **756 MiB**). Later starts use the cached binary. The helper package's name includes `memory-server`, but Kazi explicitly uses a **real MongoDB process, WiredTiger, and persistent `.data/mongo` storage**, not mock or ephemeral data. It binds only to loopback and is for local development, not internet exposure.

Ctrl+C stops the launched services and preserves the database. Do not delete `.data/mongo` unless you intend to erase local data. Backend dependencies are installed into `backend/.venv`; local development overrides connection/origin/cookie settings for the loopback stack, but leaves SMTP/AI credentials in the normal backend environment.

- `npm run check:local` starts the database/API, verifies health, and **stops them**. It is a diagnostic, not a persistent server.
- `npm run test:mongo` runs real replica-set rollback/concurrency tests against disposable test databases and stops its services. The main database is not used for test records.
- For an existing Mongo deployment configured in `backend/.env`, use `npm run dev -- --external-mongo` (or `npm run dev:backend -- --external-mongo`). This skips managed Mongo and preserves the backend's configured connection.
- Do not run this launcher and the Docker stack on the same default ports simultaneously.

## Quick start — Docker

From the project root, copy the backend environment template:

**PowerShell**

```powershell
Copy-Item backend/.env.example backend/.env
```

**Bash**

```sh
cp backend/.env.example backend/.env
```

Review `backend/.env`. For the default local setup use `FRONTEND_ORIGIN=http://localhost:3000` and `COOKIE_SECURE=false`. Leave `ENVIRONMENT=development`. Set optional SMTP/AI credentials there, **never in frontend variables**.

```sh
docker compose up --build -d
docker compose logs -f api web
```

Open **http://localhost:3000** and register an account. Use `localhost`, not `127.0.0.1`, in the browser: the backend checks the exact configured origin.

- Frontend: http://localhost:3000
- API docs: http://localhost:8000/api/docs
- Health: http://localhost:8000/api/health

```sh
docker compose down
```

The named Mongo volume persists data across restarts. `docker compose down -v` **deletes that database**; do not run it unless you intend to erase local data.

The root Compose stack and `backend/compose.yaml` are alternative setups. Do not run both at once: they use the same local ports. Compose is for local development only; the database has no authentication/TLS. See [deployment guidance](docs/deployment.md).

## Local development — Windows

Install Docker Desktop, then start just the database from the root:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env.local
docker compose up -d mongo
```

For a Python API running on the host, put this URI in `backend/.env`:

```text
MONGO_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true
```

`directConnection=true` lets the host reach the Docker single-node replica set without resolving its internal `mongo` hostname. Atlas users should use their authenticated TLS connection string instead.

In one terminal:

```powershell
cd backend
py -3 -m venv .venv
.venv/Scripts/python.exe -m pip install --upgrade "pip>=26.2.2"
.venv/Scripts/python.exe -m pip install -e ".[test]"
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers
```

In another:

```powershell
cd frontend
npm ci
npm run dev
```

The frontend's server-only `BACKEND_URL` defaults to `http://127.0.0.1:8000`. The browser calls `/api` on the frontend origin, and Next forwards cookies and requests to FastAPI. No token is stored in localStorage.

On macOS/Linux use `python3 -m venv .venv`, `.venv/bin/python`, and `cp` instead. Always launch Python from `backend` so `.env` is discovered.

## Your first workflow

1. Register and set your preferred reporting timezone in **Settings**.
2. Create a project, then create tasks with real due dates and estimates.
3. Move a task in **Kanban**, reload, and check that its status persists.
4. Add a calendar block. An overlapping block is rejected rather than overwriting another.
5. Record actual minutes and complete a task; see its activity in **Analytics**.
6. Configure the AI key, ask for a plan, review the proposed actions, then explicitly confirm them.

Calendar/task date editing uses the device timezone, called out in the UI; stored timestamps are UTC. Reporting and due-date filtering use the profile timezone.

## Validation

Backend, from `backend`:

```powershell
.venv/Scripts/python.exe -m pytest
.venv/Scripts/python.exe -m compileall -q app tests
.venv/Scripts/python.exe -m pip_audit --skip-editable
```

Frontend, from `frontend`:

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

The browser suite starts/stops its own bounded test web server on port 3100. It uses isolated API fixtures, **not a live database**, to verify UI interaction. The backend default tests use mongomock and mocked SMTP/LLM, with an explicit test-only rollback adapter because mongomock cannot execute Mongo transactions.

To test actual replica-set transactions, point tests to a disposable local/test Mongo deployment:

```powershell
$env:KAZI_TEST_MONGO_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true'
.venv/Scripts/python.exe -m pytest tests/test_mongo_integration.py
```

These tests create/drop their own randomly named database, not `kazi`. They need database creation/drop permissions. Do not use production credentials.

An additional integration test exercises real HTTP through Next to FastAPI (cookies, CSRF, CRUD, analytics, logout/login), using isolated test-only database storage. After building the frontend, run from `backend` with ports 8000 and 3102 free:

```powershell
$env:KAZI_TEST_NEXT_PROXY='1'
.venv/Scripts/python.exe -m pytest tests/test_next_proxy.py
```

It starts and stops both services itself. This verifies the proxy connection, not Mongo persistence across process restarts.

## Current boundaries

This is a working first implementation, not a claim of a production security audit.

- Reminders are **in-app, scanned on refresh** (the open workspace refreshes every minute). No background email/push delivery while the app is closed.
- Actual minutes are entered explicitly; there is no running timer or guessed time tracking.
- File attachments are not implemented.
- AI supports task creation and scheduling existing tasks. It cannot delete/update existing tasks, and a breakdown creates proposed tasks rather than silently rewriting a task's embedded subtasks. Chat text is view-local; follow-up prompts should restate necessary context. Pending proposals expire after 24 hours.
- AI calls share relevant private workspace content with the configured provider and may incur costs. Model-generated advice remains advisory. No key means no AI simulation.
- Auth/AI rate limiting is in-memory and **single-process**. Add shared rate limiting and trusted real-IP handling before scaling.
- Real MongoDB startup and replica-set rollback/concurrency tests have now been verified through the Docker-free launcher. SMTP delivery, paid AI calls, and Docker container startup still require deployment-environment verification.

## Structure and further documentation

```text
frontend/src/app/           Next.js auth and workspace routes
frontend/src/components/   Reusable feature UI
frontend/src/providers/    Authentication/data synchronization and UI state
frontend/src/lib/          API client, dates, task filters
frontend/tests/            Unit and browser tests
backend/app/api/           Authentication, CRUD, schedules, insights routes
backend/app/core/          Configuration and session security
backend/app/db/            Mongo indexes and transaction boundary
backend/app/schemas/       Validated input and AI-action schemas
backend/app/services/      Domain rules, analytics, AI proposals
backend/tests/             API, isolation, rollback and integration tests
docs/                      Architecture, database, API and deployment notes
```

- [Architecture](docs/architecture.md)
- [Database](docs/database.md)
- [API guide](docs/api.md)
- [Deployment and security checklist](docs/deployment.md)
- [Backend implementation notes](backend/README.md)
