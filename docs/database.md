# Database

MongoDB 6+ replica set required; version 8 recommended. Development Compose persists its data in a named volume. Production requires authenticated TLS connections and restricted network access.

## Collections

| Collection | Purpose and relationships |
| --- | --- |
| `users` | UUID `id`, unique normalized email, Argon2 password hash, name, timezone, notification preference, auth version, write revision, created timestamp |
| `sessions` | SHA-256 token digest, owning user, auth version, expiry; plaintext token only in HttpOnly browser cookie |
| `password_resets` | One hashed one-time token per user, auth version, expiry |
| `tasks` | Owner, optional owned project, title/description/category/status/priority, UTC dates, estimated/actual minutes, embedded subtasks, tags, reminder lead time, created/updated/completed timestamps and internal version |
| `projects` | Owner, name/description, dates, priority/status, created/updated timestamps; progress calculated from current associated tasks |
| `notes` | Owner, title/content, created/updated timestamps |
| `schedules` | Owner, owned task, UTC start/end, optional unique AI operation ID |
| `notifications` | Owner, event key, optional task/project/schedule reference, title/message, read state, created timestamp |
| `activity` | Owner/task, actual completion or reopen transition and occurrence time; retained after task deletion |
| `proposals` | Owner, validated actions, summary, pending/confirmed state, timestamps, 24-hour pending expiry |

Subtasks are embedded inside tasks to keep their lifecycle atomic. There is no separate subtask collection or attachment store.

## Indexes

Index definitions are authoritative in `backend/app/db/mongo.py`:

- Unique external UUIDs and compound `(user_id, id)` ownership indexes.
- Unique normalized user email.
- Task owner/project and schedule owner/time indexes.
- Session token uniqueness, user lookup, and expiry TTL.
- Password-reset token uniqueness, one record per owner, expiry TTL.
- Notification uniqueness on `(user_id, event_key)`.
- Activity owner/time lookup.
- Partial unique `(user_id, operation_id)` for AI-created tasks/schedules.
- Pending proposal expiry TTL, removed after confirmation to preserve idempotency.

TTL cleanup is asynchronous. Authentication and confirmation explicitly check expiry; deletion by Mongo is not relied on for authorization.

## Transaction semantics

All task/project/note/schedule domain mutations and AI confirmations use Mongo sessions with snapshot read concern and majority write concern. The user revision write serializes conflicting domain changes. HTTP 409 may indicate a concurrent transaction; the UI surfaces it for retry. Unavailable database or unsupported standalone transactions return 503, not false success.

Project deletion detaches tasks and removes its notifications. Task deletion removes its schedules and task-associated notifications. Historical activity remains by design. Confirmed AI proposals must be retained as long as clients may retry their IDs.

## Time and history

Store aware UTC dates normalized to BSON millisecond precision. Date editing is explicitly device-local in the UI; profile timezone controls due-date filtering and report buckets. Actual minutes are explicit task fields and are never inferred from estimates. A completion event means a genuine user task-state transition, not an AI prediction.

No migration runner exists yet. Schema changes should include a deliberate migration/backfill and backup plan before production; do not assume startup indexes migrate old documents.
