import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ApiError, errorMessage, json } from "../src/lib/api";
import { addDays, dayKey, iso, localInput } from "../src/lib/dates";
import { emptyFilters, filterTasks } from "../src/lib/tasks";
import type { Task } from "../src/types";
// Synthetic records are test fixtures only; the application never seeds user data.
const base: Task = {
  id: "test",
  title: "Plan launch",
  description: "Review the brief",
  category: "Work",
  priority: "high",
  status: "todo",
  start_at: null,
  due_at: "2026-11-01T01:00:00Z",
  estimated_minutes: 30,
  actual_minutes: 0,
  subtasks: [],
  tags: ["Focus"],
  project_id: "project",
  reminder_minutes: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  completed_at: null,
};
const now = new Date("2026-11-01T12:00:00Z");
test("empty filters preserve real input records", () =>
  assert.deepEqual(filterTasks([base], emptyFilters, "UTC", now), [base]));
test("search matches title, description and tags without case sensitivity", () => {
  for (const search of ["LAUNCH", "brief", "focus"])
    assert.equal(
      filterTasks([base], { ...emptyFilters, search }, "UTC", now).length,
      1,
    );
});
test("filters compose priority, category, status and project", () => {
  assert.equal(
    filterTasks(
      [base],
      {
        ...emptyFilters,
        priority: "high",
        category: "Work",
        status: "todo",
        project: "project",
      },
      "UTC",
      now,
    ).length,
    1,
  );
  assert.equal(
    filterTasks([base], { ...emptyFilters, priority: "low" }, "UTC", now)
      .length,
    0,
  );
});
test("due today respects the account timezone", () => {
  assert.equal(
    filterTasks([base], { ...emptyFilters, due: "today" }, "UTC", now).length,
    1,
  );
  assert.equal(
    filterTasks(
      [base],
      { ...emptyFilters, due: "today" },
      "America/Los_Angeles",
      now,
    ).length,
    0,
  );
});
test("completed tasks never appear as overdue", () => {
  assert.equal(
    filterTasks([base], { ...emptyFilters, due: "overdue" }, "UTC", now).length,
    1,
  );
  assert.equal(
    filterTasks(
      [{ ...base, status: "completed" }],
      { ...emptyFilters, due: "overdue" },
      "UTC",
      now,
    ).length,
    0,
  );
});
test("undated and next-seven-days filters work", () => {
  assert.equal(
    filterTasks(
      [{ ...base, due_at: null }],
      { ...emptyFilters, due: "none" },
      "UTC",
      now,
    ).length,
    1,
  );
  assert.equal(
    filterTasks(
      [{ ...base, due_at: "2026-11-03T12:00:00Z" }],
      { ...emptyFilters, due: "week" },
      "UTC",
      now,
    ).length,
    1,
  );
  assert.equal(
    filterTasks([base], { ...emptyFilters, due: "week" }, "UTC", now).length,
    0,
  );
});
test("date helpers preserve local input round trips and calendar days", () => {
  const input = "2026-11-02T09:15";
  assert.equal(localInput(iso(input)), input);
  assert.equal(iso(""), null);
  assert.equal(
    dayKey("2026-11-01T01:00:00Z", "America/Los_Angeles"),
    "2026-10-31",
  );
  const start = new Date(2026, 10, 1, 9);
  assert.equal(addDays(start, 2).getDate(), 3);
  assert.equal(start.getDate(), 1);
});
test("API errors support direct detail strings and FastAPI validation arrays", () => {
  assert.equal(
    errorMessage({ detail: "Schedule conflict" }, "fallback"),
    "Schedule conflict",
  );
  assert.equal(
    errorMessage(
      { detail: [{ loc: ["body", "title"], msg: "Required" }] },
      "fallback",
    ),
    "title: Required",
  );
  assert.equal(errorMessage(null, "fallback"), "fallback");
});
test("API uses same-origin cookies, JSON, direct objects and handles 204", async () => {
  const original = globalThis.fetch;
  try {
    let request: RequestInit | undefined;
    let url: unknown;
    globalThis.fetch = async (input, init) => {
      url = input;
      request = init;
      return new Response(JSON.stringify({ id: "saved" }), { status: 201 });
    };
    assert.deepEqual(await api("/tasks", json("POST", { title: "A" })), {
      id: "saved",
    });
    assert.equal(url, "/api/tasks");
    assert.equal(request?.credentials, "same-origin");
    assert.equal(request?.cache, "no-store");
    assert.equal(
      (request?.headers as Record<string, string>)["Content-Type"],
      "application/json",
    );
    assert.equal(request?.body, '{"title":"A"}');
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.equal(await api("/tasks/id", json("DELETE")), undefined);
  } finally {
    globalThis.fetch = original;
  }
});
test("unreachable API proxy provides actionable backend startup guidance", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });
    await assert.rejects(api("/auth/me"), (error: unknown) =>
      error instanceof ApiError && error.status === 500 && error.message.includes("npm run dev:backend"),
    );
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Database temporarily unavailable" }), { status: 503 });
    await assert.rejects(api("/auth/me"), /Database temporarily unavailable/);
  } finally {
    globalThis.fetch = original;
  }
});

test("API preserves conflict details and provides network failure errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          detail: "Schedule conflict; choose a different time.",
        }),
        { status: 409 },
      );
    await assert.rejects(
      api("/schedules"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        error.message.includes("Schedule conflict"),
    );
    globalThis.fetch = async () => {
      throw new TypeError("offline");
    };
    await assert.rejects(api("/tasks"), /Unable to reach Kazi/);
  } finally {
    globalThis.fetch = original;
  }
});
