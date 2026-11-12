# API guide

Base prefix: `/api`. Interactive development documentation: `/api/docs`. Responses are direct JSON objects/arrays. Errors: `{ "detail": "actionable message" }`. Creates return 201; deletes/logout return empty 204 responses.

## Authentication

| Method | Path | Request |
| --- | --- | --- |
| POST | `/auth/register` | `{name,email,password}` |
| POST | `/auth/login` | `{email,password}` |
| POST | `/auth/logout` | None |
| GET | `/auth/me` | None |
| PATCH | `/auth/me` | `{name?,timezone?,notifications_enabled?}` |
| POST | `/auth/forgot-password` | `{email}` |
| POST | `/auth/reset-password` | `{token,password}` |

User response: `{id,name,email,timezone,notifications_enabled}`. Registration/login set an HttpOnly session cookie. Passwords are 10–128 characters, whitespace significant. Reset revokes sessions. Reset tokens are sent only by SMTP, never returned or logged.

Every unsafe method requires an `Origin` matching `FRONTEND_ORIGIN` (or a matching Referer). Send cookies with requests. API scripts must supply the configured origin too. Session IDs, password hashes and provider credentials are never exposed.

## Productivity resources

| Methods | Path | Purpose |
| --- | --- | --- |
| GET, POST | `/tasks` | List/create owned tasks |
| PATCH, DELETE | `/tasks/{id}` | Update/delete an owned task |
| GET, POST | `/projects` | List/create projects, with derived progress |
| PATCH, DELETE | `/projects/{id}` | Update/delete; deletion preserves tasks |
| GET, POST | `/notes` | List/create notes |
| PATCH, DELETE | `/notes/{id}` | Update/delete |
| GET, POST | `/schedules` | List/create owned task time blocks |
| PATCH, DELETE | `/schedules/{id}` | Explicitly reschedule/remove |
| GET | `/notifications` | Scan/read current in-app notifications |
| PATCH | `/notifications/{id}` | `{read:true}` or `{read:false}` |
| GET | `/analytics` | Actual counts, time, daily/weekly/monthly completion history, projects and insights |
| GET | `/health` | Database readiness and AI-configured flag |

Task input fields:

```json
{
  "title": "Prepare presentation",
  "description": "Outline the project demo",
  "category": "Study",
  "priority": "high",
  "status": "todo",
  "start_at": null,
  "due_at": "2030-01-10T17:00:00+05:30",
  "estimated_minutes": 60,
  "actual_minutes": 0,
  "subtasks": [{"title": "Outline slides", "completed": false}],
  "tags": ["presentation"],
  "project_id": null,
  "reminder_minutes": 30
}
```

Priority: `high | medium | low`. Task status: `todo | in_progress | completed`. Project status: `active | on_hold | completed`. Project create accepts `name,description,start_at,deadline,status,priority`. Note create accepts `title,content`. IDs are canonical UUID strings; subtask IDs can be generated server-side on create. Dates must include timezones. PATCH replaces supplied arrays in full; fields omitted from PATCH retain their values. Only nullable fields accept explicit null.

Schedule create: `{task_id,start_at,end_at}`. Schedule PATCH: `{start_at,end_at}`. End must follow start. Intervals are half-open: adjacent blocks are allowed, overlaps rejected with 409 and an actionable suggestion. A completed task must be reopened before scheduling.

## Assistant

`POST /assistant/chat` with `{ "message": "Plan my day" }` returns:

```json
{
  "reply": "I've prepared a proposal. Review and confirm it before any tasks or schedules are saved.",
  "proposal": {
    "id": "a-proposal-uuid",
    "summary": "A proposed task",
    "status": "pending",
    "actions": [{"type": "create_task", "task": {"title": "Prepare outline"}}]
  }
}
```

The example is schematic; actual tasks include validated default fields. Analysis-only responses have `proposal: null`. Supported actions: `create_task` and `schedule_task` (existing owned task ID plus start/end). `POST /notes/{id}/convert` returns the same shape, grounded in the selected owned note.

**Only** `POST /assistant/proposals/{id}/confirm` applies the actions. It revalidates everything and commits changes atomically. Retrying a confirmed ID returns success without creating duplicates. Expired drafts return 410; stale/conflicting state is rejected rather than overwritten. Clients must show a preview and require confirmation.

Missing AI/SMTP configuration returns 503. Provider failures return sanitized 502/504 errors, never fabricated successes. API reference and exact schemas are generated from Pydantic in `/api/openapi.json` in development.
