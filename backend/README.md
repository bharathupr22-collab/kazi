# Kazi backend

Synchronous FastAPI + PyMongo API. All application code and tooling live in this directory. There are no seeded/mock production records. API prefix is `/api`; Next should proxy `/api/:path*` to `http://127.0.0.1:8000/api/:path*` without stripping the prefix or the incoming `Origin`, `Cookie`, or response `Set-Cookie` headers.

## Run

Requires Python 3.11+ and MongoDB 6+ **as a replica set** (MongoDB 8 recommended). Transactions are used for domain writes, not only AI confirmation: this keeps foreign keys, completion events, project detachment, task deletion and schedule conflict checks atomic under concurrent writes. Standalone MongoDB is not supported for these writes and returns an actionable 503; it is never silently downgraded to non-atomic behavior.

From `backend`:

```sh
python -m venv .venv
# Windows: .venv/Scripts/python.exe; Unix: .venv/bin/python
.venv/Scripts/python.exe -m pip install --upgrade "pip>=26.2.2"
.venv/Scripts/python.exe -m pip install -e ".[test]"
cp .env.example .env
# Edit .env with your server-side SMTP/LLM settings.
docker compose up --build -d
```

Compose starts both the API and a persistent single-node Mongo replica set, initializes the replica set via a health check, and binds exposed ports to loopback. To run Python locally instead, start only MongoDB with `docker compose up -d mongo` and use:

```sh
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers
```

The example URI uses `directConnection=true` so a local Python process can reach the Docker replica set without resolving its internal `mongo` hostname. Compose overrides the API URI with the container hostname automatically. API documentation: `/api/docs` (disabled in production). Liveness/readiness: `/api/health`, also `/health`. Startup creates unique/ownership/time/TTL indexes and fails rather than serving without indexes.

**Compose is for local development**, not an internet-facing database: MongoDB authentication/TLS and replica keyfiles are not configured. For production use an authenticated, TLS-enabled replica set/Atlas connection, HTTPS at the reverse proxy, `ENVIRONMENT=production`, `COOKIE_SECURE=true`, and an exact HTTPS `FRONTEND_ORIGIN`. Restrict database networking and Mongo permissions, protect backups, and keep the `.env` file out of source control. TLS terminates at your reverse proxy, not Uvicorn. Do not expose MongoDB publicly.

## API contract

All responses are direct objects/arrays, not envelopes. Errors are `{ "detail": "message" }`. Validation errors are also strings and do not reflect credential inputs. Delete/logout responses are empty 204s. Creates return 201; login and confirmation return 200. IDs are canonical UUID strings. Timestamps are timezone-aware ISO UTC strings with BSON millisecond precision. Unknown input keys are rejected. Task/project date ordering, interval duration, UUID foreign keys, enum values, bounded text/list lengths, and IANA timezones are validated.

- `POST /api/auth/register` `{name,email,password}` → User + cookie.
- `POST /api/auth/login` `{email,password}` → User + cookie.
- `POST /api/auth/logout` → 204 (idempotent).
- `GET /api/auth/me`, `PATCH /api/auth/me` `{name?,timezone?,notifications_enabled?}` → User.
- `POST /api/auth/forgot-password` `{email}` → generic `{message}`.
- `POST /api/auth/reset-password` `{token,password}` → `{message}`; revokes all sessions.
- `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/{id}`. All agreed Task fields are supported. Subtask IDs are optional on create; missing IDs are generated. PATCH replaces supplied arrays in full. Only date/project/reminder fields accept null. Project references must belong to the current user.
- `GET/POST /api/projects`, `PATCH/DELETE /api/projects/{id}`. Responses include task counts and task-derived progress (0–100). Deletion **detaches**, rather than deletes, tasks.
- `GET/POST /api/notes`, `PATCH/DELETE /api/notes/{id}`.
- `POST /api/notes/{id}/convert` → the same `{reply,proposal}` as assistant chat, generated from the actual owned note. **Additive endpoint**, not a change to the shared contract. No task writes until proposal confirmation. Alternatively, use assistant chat to request note conversion from its actual note context.
- `GET/POST /api/schedules`, `PATCH/DELETE /api/schedules/{id}`. Create `{task_id,start_at,end_at}`; PATCH `{start_at,end_at}`. Intervals are half-open: adjacent appointments are allowed. Overlaps return actionable 409 errors. Completed tasks must be reopened before scheduling. Schedule responses always join the current owned task title. Task deletion removes its schedules.
- `GET /api/notifications`, `PATCH /api/notifications/{id}` `{read:bool}`. Notification responses contain only `{id,title,message,read,created_at}`.
- `GET /api/analytics` → `{total,completed,pending,overdue,completion_rate,total_minutes,weekly,projects,insights}`.
- `POST /api/assistant/chat` `{message}` → `{reply,proposal:null|{id,summary,actions,status:'pending'}}`.
- `POST /api/assistant/proposals/{id}/confirm` → `{message,proposal_id}`.

User responses contain exactly `{id,name,email,timezone,notifications_enabled}`. Session tokens, hashes, Mongo internal IDs, operation IDs, ownership fields and provider secrets are never returned.

### Sessions, CSRF and rate limits

Passwords use Argon2id (64 MiB memory, three iterations). Passwords are 10–128 characters, preserving whitespace. Sessions use a fresh cryptographically random 48-byte opaque token in an HttpOnly, SameSite=Lax, host-only cookie. Only its SHA-256 digest is stored. Session lifetime defaults to seven days; expiry is checked on every request regardless of Mongo's asynchronous TTL cleanup. Login rotates the current session; logout deletes it. Password reset consumes a one-time hashed token and increments the user's auth version to invalidate even concurrently issued old-version sessions.

**Every unsafe request**, including register/login, requires the exact configured frontend `Origin`; same-origin `Referer` is a fallback. Missing/mismatched origins and explicitly cross-site browser requests are rejected. CORS is credentialed for the one configured origin, never `*`. Browser clients use the Next same-origin proxy and `credentials: 'include'`. CLI clients must send `Origin: http://localhost:3000` (or your configured origin). No bearer tokens or secrets belong in frontend environment variables. Responses carry `Cache-Control: no-store`.

Auth register/login/forgot/reset share a thread-safe sliding-window IP budget (default 10 attempts/15 minutes), with no trust in arbitrary forwarded headers. AI has a separate per-user budget (default 20/hour). Bodies are capped at 256 KiB including chunked transfers. The in-memory rate limiter is **single-process only**: keep `--workers 1`, and add a shared Redis/edge limiter before scaling. Behind a proxy, it sees the proxy IP (safe but potentially overly restrictive); configure real-IP protection and shared limiting at your trusted edge. Domain/AI atomicity itself uses Mongo transactions and remains safe across processes. Transaction write conflicts return retryable 409s; database failures return 503s.

### Password reset email

Set SMTP host, port, sender and, if needed, credentials. STARTTLS certificate verification is enabled by default. Reset tokens are generated server-side, stored only as hashes, and sent **only via SMTP**. No API response or application log includes the token. The link is `${FRONTEND_ORIGIN}/reset-password?token=...`; frontend reset pages must avoid analytics/referrer leakage. Tokens expire after 30 minutes by default and are single-use. Unknown email addresses receive the same response and an unusable token email, minimizing account-existence timing differences. This makes rate limiting essential to prevent email abuse. A later reset request supersedes earlier tokens. SMTP missing/failure returns 503 rather than pretending delivery succeeded. No password-reset background worker or insecure console-token fallback is present.

### Notifications and analytics

Notification scanning occurs on `GET /notifications`: due-task reminders and overdue alerts, project deadlines (within 24 hours or overdue), and scheduled activities (within 15 minutes or currently running) are deduplicated by owner/resource/event/time. Completed tasks/projects and ended schedules do not generate new alerts. Preferences disable **new** notifications, not existing history. Task reminders use `due_at` minus `reminder_minutes`; no advance task reminder is generated when `reminder_minutes` is null. Project deletion removes its notifications; task deletion removes task/schedule notifications. No push, background scan, or general notification email service is implemented.

Analytics are strictly derived from the authenticated user's stored records. Totals/rate/overdue/project progress are current task snapshots; pending means all non-completed tasks. `total_minutes` sums currently stored, explicitly reported task `actual_minutes`, never estimates or AI guesses. Weekly and monthly counts use actual completion transition activity, bucketed into seven/30 calendar days in the user's timezone, counting each task at most once per day. Daily reporting has 24 local wall-clock hour buckets, counting a task once per hour; repeated DST hours merge. Repeated status updates do not fabricate events. Reopening/deleting a task does not erase historical completion activity. Insights are transparent statements derived from those values, not fabricated trends. There is no timer worker: clients explicitly report actual minutes.

### AI configuration, safety and privacy

Set server-only `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` and `OPENAI_MODEL`. The provider must implement OpenAI-compatible `/chat/completions` with JSON object responses. No key → helpful 503, **never fake AI**. Provider errors → sanitized 502/504. No redirects are followed with the API key.

The authenticated user's actual tasks, projects, notes, schedules, timezone and analytics are sent to the configured provider. **This shares personal data with that provider and may incur token costs/provider retention.** Context is bounded (~90 KB, plus an explicitly selected note up to 20 KB); collection truncation is signaled, and general content fields are clipped to 2,000 characters. Context truncation can require the user to be more specific. No other user's records, email, hashes or sessions are sent.

LLM output is parsed with strict Pydantic models (including nested TaskCreate/UUID/date constraints). Only `create_task` and `schedule_task` are permitted. Task breakdown creates multiple proposed tasks. Scheduling refers to **existing** owned tasks; a proposal cannot reference an as-yet-uncreated task. Analysis can return a reply without actions. Notes/context are explicitly marked untrusted; server-side action allowlisting, ownership and business checks remain authoritative even under prompt injection. AI cannot fabricate tracked minutes or completed-work events. Action-bearing replies use server-controlled wording that explicitly says nothing is saved yet; free-form analysis remains model-generated and should be treated as advisory.

A proposal is only a stored draft, expires in 24 hours, and is not a task/schedule write. Confirmation revalidates *all* actions against current state before writing. All writes and the final confirmation status occur in a single Mongo transaction. Every domain writer first updates a per-user revision document: this forces concurrent snapshots for that user to conflict rather than accepting overlapping schedules or stale foreign keys. Each created record has a unique `(user_id, operation_id)` index based on proposal/action position. Confirmed proposals retain their idempotency record without the pending TTL. Retry of a confirmed proposal returns success without repeating actions, including after an uncertain network response. If a transaction conflicts, retry the same confirmation endpoint. Do not build frontend auto-confirm behavior: show the proposal for explicit user review first.

## Tests and validation

```sh
.venv/Scripts/python.exe -m pytest
.venv/Scripts/python.exe -m compileall -q app tests
.venv/Scripts/python.exe -m pip_audit --skip-editable
```

The default suite is fully offline using mongomock and mocked LLM HTTP/SMTP. Coverage includes auth/CSRF/expiry/reset/rate limits, all CRUD fields, scoped foreign keys, cross-user access, scheduling boundaries/conflicts, notification preferences/deduplication, completion-derived analytics, actual-user AI context, schema rejection, no-key behavior, preflight failure, injected mid-batch failure rollback, retries and simultaneous confirmation.

Mongomock does **not** implement real Mongo sessions/transactions. Tests use an explicitly injected test-only snapshot/rollback adapter guarded by a lock; production never falls back to it. Thus offline tests verify application behavior, not Mongo snapshot isolation/network behavior. Optional real-replica tests can be enabled with `KAZI_TEST_MONGO_URI` (see `tests/test_mongo_integration.py`); they create/drop a fresh random test database only. A real replica set smoke test is recommended before deploying. An additional opt-in `tests/test_next_proxy.py` runs actual Next-to-FastAPI HTTP requests and cookies against isolated test-only storage: build the frontend first, then set `KAZI_TEST_NEXT_PROXY=1` when running that test. It requires free loopback ports 8000 and 3102 and stops both services when finished; it is not a substitute for real Mongo transaction testing. External SMTP delivery, an actual paid LLM provider, Docker image startup and production networking must be validated in your environment.
