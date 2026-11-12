# Deployment and operational checklist

## Local development without Docker

Run `npm install` and `npm run dev` at the project root (Node 22+ and Python 3.11+ required). The launcher downloads/caches official MongoDB binaries, runs a real loopback-only replica set, starts FastAPI and Next, and preserves WiredTiger data in `.data/mongo` on shutdown. If the frontend is already running, use `npm run dev:backend` in another terminal instead. Keep the launcher terminal open.

`npm run check:local` and `npm run test:mongo` are bounded diagnostics that stop their services after checking. The latter has verified actual transaction rollback and concurrent schedule conflict behavior, not just a mocked database. The local stack has no Mongo authentication and must never be exposed remotely. Its first Windows binary download is approximately 756 MiB. For a separately configured database, pass `--external-mongo`.

## Local containers

Use the root `compose.yaml` for frontend + API + persistent single-node Mongo replica set. Copy `backend/.env.example` to `backend/.env` first. Docker Desktop must use Linux containers. The frontend is a multi-stage, non-root standalone Next build; API also runs as a non-root user.

The frontend rewrite target is **baked into the Next build**. Root Compose passes `BACKEND_URL=http://api:8000` at build time. If the backend host changes, rebuild the frontend image; runtime environment changes alone do not rewrite the generated routing manifest.

Database and API health checks gate startup. Initial Mongo replica-set election can take several seconds. Startup intentionally fails if indexes cannot be created. Never run both Compose files at the same time on the default ports.

## Production requirements

The supplied Compose file is **not production-hardened**. Before internet exposure:

- Use authenticated, TLS-enabled MongoDB Atlas or a secured replica set. Restrict network access and database permissions, configure replica authentication, encrypted storage, backups and restore tests. Do not expose the local development Mongo container.
- Terminate HTTPS at a trusted reverse proxy; set `ENVIRONMENT=production`, `COOKIE_SECURE=true`, and the exact HTTPS `FRONTEND_ORIGIN` with no trailing slash. Keep browser/API calls same-origin through Next.
- Supply secrets using deployment secret storage. Never commit `.env`, put API keys in `NEXT_PUBLIC_*`, send tokens to logs, or share screenshots of credentials.
- Keep Uvicorn at one worker until a shared auth/AI rate limiter is implemented. Arbitrary `X-Forwarded-For` headers are not trusted. Configure real-IP protection at the trusted edge before scaling; otherwise proxy IPs share a limit budget.
- Restrict direct API exposure and configure trusted hosts/reverse-proxy routing and request limits. Apply HTTPS/HSTS at the edge and assess a suitable CSP for Next's script delivery.
- Disable development API docs (automatic in production), run dependency/security audits, review application authorization and operational monitoring.
- Configure verified SMTP credentials and sender/domain records; test reset token expiry, reuse rejection and session revocation using actual delivery.
- Choose the AI provider/model deliberately. Review data retention, privacy, processing location, rate limits and costs. The user's workspace content is sent to that provider. No redirects are followed with provider authorization.
- Add production error/latency metrics, sanitized structured logging, alerting and budget controls. Logs must not include cookie headers, reset tokens, passwords, provider credentials or private prompt bodies.
- If closed-app reminders are required, add a durable job worker and opt-in delivery channel. Current scanning is in-app only, not guaranteed push/email delivery.

## Validation before release

1. Run backend tests and frontend typecheck/unit/browser suites.
2. Run `tests/test_mongo_integration.py` against a disposable **real replica set** to verify rollback, idempotency and concurrent schedule conflict behavior. Optionally run `tests/test_next_proxy.py` with `KAZI_TEST_NEXT_PROXY=1` after a frontend build to verify actual proxy HTTP/cookies with isolated test storage (ports 8000 and 3102 must be free).
3. Start the actual container stack and perform registration → create project/task → move Kanban → reload → schedule/conflict → complete task → analytics.
4. Use a second account to verify resource URLs never reveal or mutate another user's records.
5. Exercise SMTP delivery and a paid-provider AI request; review the proposal before confirming and retry its confirmation to verify no duplication.
6. Restart services and verify the named database volume retains records. Test backup restore independently.
7. Test mobile viewport/keyboard, account timezone, daylight-saving transitions, and expired sessions.

Automated browser tests use fixtures, not live services. Offline mongomock tests use a test-only transaction adapter, not Mongo snapshot isolation. Do not treat either as proof of external-service reliability. Real replica-set rollback/concurrency tests now pass through the Docker-free launcher. Docker/container startup, external SMTP and paid AI calls remain unverified.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| CSRF 403 | Browser origin must exactly equal `FRONTEND_ORIGIN`; use `http://localhost:3000`, not the loopback IP, with defaults. Reverse proxies must preserve Origin. |
| API 502 / connection refused | Ensure API runs, `BACKEND_URL` is correct at frontend build time, and Mongo is healthy. |
| Transaction 503 | Connect to a replica set, not standalone Mongo. For local host → Docker Mongo use `directConnection=true`. |
| Concurrent update 409 | Refresh/retry; do not create a new AI proposal just to retry its confirmation ID. |
| AI 503 | Configure server-only provider key, base URL and compatible model. No local fake-AI fallback exists. |
| Reset email 503 | Set SMTP host/port/sender/auth/TLS; test outbound access and sender verification. |
| Shared 429 limits | Single-process limiter currently groups clients behind the same untrusted proxy IP. Configure trusted edge/shared limiting. |
| No closed-app reminders | Expected: currently in-app scanning only. |

## Data safety

`docker compose down` preserves the volume. `docker compose down -v` erases it. Avoid schema/index changes without backups and a deliberate migration. Confirmed AI proposal idempotency records must not be pruned casually, because clients may retry earlier confirmations.
