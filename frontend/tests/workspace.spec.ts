import { test, expect, type Page } from "@playwright/test";
import type { Task, Notification } from "../src/types";
test("scheduled blocks create, reschedule with explicit confirmation, and remove", async ({
  page,
}) => {
  const state = await workspace(page, true, false);
  await page.goto("/calendar");
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  await page
    .getByRole("button", { name: "Schedule time", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Task", exact: true })
    .selectOption(state.tasks[0].id);
  await dialog.getByLabel("Starts", { exact: true }).fill(`${today}T09:00`);
  await dialog.getByLabel("Ends", { exact: true }).fill(`${today}T10:00`);
  await dialog.getByRole("button", { name: "Review schedule" }).click();
  expect(state.schedules).toHaveLength(0);
  await dialog.getByRole("button", { name: "Confirm schedule" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.schedules).toHaveLength(1);
  await page.locator(".calendar-event").first().click();
  await dialog.getByLabel("Starts", { exact: true }).fill(`${today}T11:00`);
  await dialog.getByLabel("Ends", { exact: true }).fill(`${today}T12:00`);
  await dialog.getByRole("button", { name: "Review schedule" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Integration task", exact: true }),
  ).toBeVisible();
  expect(
    state.writes.filter(
      (w) => w.method === "PATCH" && w.path.startsWith("/schedules/"),
    ),
  ).toHaveLength(0);
  await dialog.getByRole("button", { name: "Confirm schedule" }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    state.writes.find(
      (w) => w.method === "PATCH" && w.path.startsWith("/schedules/"),
    )?.body,
  ).not.toHaveProperty("task_id");
  await page.locator(".calendar-event").first().click();
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  expect(state.schedules).toHaveLength(1);
  await dialog.getByRole("button", { name: "Confirm removal" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.schedules).toHaveLength(0);
});

test("notification panel persists read state and workspace failures can retry", async ({
  page,
}) => {
  const state = await workspace(page);
  state.notifications.push({
    id: "notification",
    title: "Task reminder",
    message: "A test-only reminder",
    read: false,
    created_at: stamp,
  });
  let failing = true;
  await page.route("**/api/notes", (route) =>
    failing
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Notes temporarily unavailable" }),
        })
      : route.fallback(),
  );
  await page.goto("/dashboard");
  await expect(page.locator(".data-error")).toContainText(
    "Notes temporarily unavailable",
  );
  failing = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".data-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
  await expect(page.getByRole("dialog")).toContainText("A test-only reminder");
  await page.getByRole("button", { name: "Mark as read" }).click();
  await expect(page.getByRole("button", { name: "Mark unread" })).toBeVisible();
  expect(state.notifications[0].read).toBe(true);
});

test("registration, reset requests and reset tokens use the correct API bodies", async ({
  page,
}) => {
  let request: Record<string, unknown> = {};
  await page.route("**/api/auth/register", (route) => {
    request = route.request().postDataJSON();
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "An account with this email already exists",
      }),
    });
  });
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Test registration");
  await page.getByLabel("Email address").fill("tester@example.test");
  await page.getByLabel("Password", { exact: true }).fill("long-test-password");
  await page.getByRole("button", { name: "Create your account" }).click();
  await expect(page.locator(".error-box")).toContainText("already exists");
  expect(request).toEqual({
    name: "Test registration",
    email: "tester@example.test",
    password: "long-test-password",
  });
  await page.route("**/api/auth/forgot-password", (route) => {
    request = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ message: "Reset instructions sent." }),
    });
  });
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill("tester@example.test");
  await page.getByRole("button", { name: "Send reset instructions" }).click();
  await expect(page.getByText("Reset instructions sent.")).toBeVisible();
  expect(request).toEqual({ email: "tester@example.test" });
  const token = "test-token-at-least-twenty-characters";
  await page.route("**/api/auth/reset-password", (route) => {
    request = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        message: "Password reset successful. Please log in.",
      }),
    });
  });
  await page.goto(`/reset-password?token=${token}`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("another-test-password");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(
    page.getByText("Password reset successful. Please log in."),
  ).toBeVisible();
  expect(request).toEqual({ token, password: "another-test-password" });
});

test("every section fits mobile without document overflow in both themes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page);
  for (const route of [
    "dashboard",
    "tasks",
    "projects",
    "calendar",
    "kanban",
    "assistant",
    "notes",
    "analytics",
    "settings",
  ]) {
    await page.goto(`/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      route,
    ).toBe(true);
  }
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.screenshot({
    path: testInfo.outputPath("dashboard-mobile-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.screenshot({
    path: testInfo.outputPath("dashboard-desktop-light.png"),
    fullPage: true,
  });
});

const stamp = "2026-11-01T09:00:00Z";
function task(title = "Integration task"): Task {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title,
    description: "A test-only task",
    category: "Work",
    priority: "medium",
    status: "todo",
    start_at: null,
    due_at: null,
    estimated_minutes: 30,
    actual_minutes: 0,
    subtasks: [],
    tags: [],
    project_id: null,
    reminder_minutes: null,
    created_at: stamp,
    updated_at: stamp,
    completed_at: null,
  };
}
async function workspace(page: Page, seeded = false, conflictSchedules = true) {
  const state = {
    tasks: seeded ? [task()] : [],
    projects: [] as Record<string, unknown>[],
    notes: [] as Record<string, unknown>[],
    schedules: [] as Record<string, unknown>[],
    notifications: [] as Notification[],
    confirmed: 0,
    writes: [] as {
      path: string;
      method: string;
      body: Record<string, unknown>;
    }[],
  };
  let profile = {
    id: "user",
    name: "Integration Tester",
    email: "tester@example.test",
    timezone: "UTC",
    notifications_enabled: true,
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api", "");
    const method = req.method();
    const body = req.postDataJSON() || {};
    const respond = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (method !== "GET") state.writes.push({ path, method, body });
    if (path === "/auth/me") {
      if (method === "PATCH") profile = { ...profile, ...body };
      return respond(profile);
    }
    if (path === "/analytics")
      return respond({
        total: state.tasks.length,
        completed: state.tasks.filter((t) => t.status === "completed").length,
        pending: state.tasks.filter((t) => t.status !== "completed").length,
        overdue: 0,
        completion_rate: 0,
        total_minutes: 0,
        weekly: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-10-${25 + i}`,
          completed: 0,
        })),
        projects: [],
        insights: ["Test-only recorded activity."],
      });
    if (path === "/notifications") return respond(state.notifications);
    if (path.startsWith("/notifications/") && method === "PATCH") {
      const id = path.split("/")[2];
      const index = state.notifications.findIndex((n) => n.id === id);
      state.notifications[index] = { ...state.notifications[index], ...body };
      return respond(state.notifications[index]);
    }
    if (path === "/auth/logout") return route.fulfill({ status: 204 });
    if (path === "/assistant/chat" || /\/notes\/[^/]+\/convert/.test(path))
      return respond({
        reply: "Review this proposal before saving.",
        proposal: {
          id: "proposal",
          summary: "Create a focused next step",
          status: "pending",
          actions: [
            {
              type: "create_task",
              task: {
                ...task("Proposed task"),
                id: undefined,
                created_at: undefined,
                updated_at: undefined,
                completed_at: undefined,
              },
            },
          ],
        },
      });
    if (path === "/assistant/proposals/proposal/confirm") {
      state.confirmed++;
      state.tasks.push({
        ...task("Proposed task"),
        id: "22222222-2222-4222-8222-222222222222",
      });
      return respond({
        message: "Proposal confirmed",
        proposal_id: "proposal",
      });
    }
    if (conflictSchedules && path === "/schedules" && method === "POST")
      return respond(
        { detail: "Schedule conflict; choose a different time." },
        409,
      );
    if (path.startsWith("/tasks")) {
      if (method === "GET") return respond(state.tasks);
      if (method === "POST") {
        const saved = { ...task(), ...body };
        state.tasks.push(saved);
        return respond(saved, 201);
      }
      const id = path.split("/")[2];
      const index = state.tasks.findIndex((t) => t.id === id);
      if (method === "PATCH") {
        state.tasks[index] = { ...state.tasks[index], ...body };
        return respond(state.tasks[index]);
      }
      if (method === "DELETE") {
        state.tasks = state.tasks.filter((t) => t.id !== id);
        return route.fulfill({ status: 204 });
      }
    }
    for (const key of ["projects", "notes", "schedules"] as const)
      if (path.startsWith(`/${key}`)) {
        if (method === "GET") return respond(state[key]);
        if (method === "POST") {
          const saved = {
            id: `${key}-id`,
            ...body,
            created_at: stamp,
            updated_at: stamp,
            task_count: 0,
            completed_count: 0,
            progress: 0,
          };
          state[key].push(saved);
          return respond(saved, 201);
        }
        const id = path.split("/")[2];
        const index = state[key].findIndex((t) => t.id === id);
        if (method === "PATCH") {
          state[key][index] = { ...state[key][index], ...body };
          return respond(state[key][index]);
        }
        if (method === "DELETE") {
          state[key] = state[key].filter((t) => t.id !== id);
          return route.fulfill({ status: 204 });
        }
      }
    return respond({ detail: "Unexpected test request" }, 404);
  });
  return state;
}

test("all workspace routes render an honest empty state without client exceptions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await workspace(page);
  for (const [route, title] of [
    ["dashboard", "Good"],
    ["tasks", "My tasks"],
    ["projects", "Your projects"],
    ["calendar", "A little space to focus"],
    ["kanban", "A little more flow"],
    ["assistant", "Meet your momentum."],
    ["notes", "Notes & little sparks"],
    ["analytics", "Your work, in perspective"],
    ["settings", "Your workspace, your way"],
  ]) {
    await page.goto(`/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(page.locator(".error-box, .data-error")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("task editor saves every field, edits, filters and confirms deletion", async ({
  page,
}) => {
  const state = await workspace(page);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Task title", { exact: true })
    .fill("Write the brief");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("A clear next step");
  await dialog.getByLabel("Category", { exact: true }).fill("Studio");
  await dialog
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("high");
  await dialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("in_progress");
  await dialog.getByLabel(/Tags/).fill("focus, launch");
  await dialog.getByLabel("Start date & time").fill("2026-11-02T09:00");
  await dialog.getByLabel("Due date & time").fill("2026-11-03T12:00");
  await dialog.getByLabel("Estimate (minutes)").fill("90");
  await dialog.getByLabel("Actual (minutes)").fill("15");
  await dialog.getByLabel("Remind before (min)").fill("30");
  await dialog.getByRole("button", { name: "Add subtask" }).click();
  await dialog.getByLabel("Subtask 1 title").fill("Outline");
  await dialog.getByLabel("Complete subtask 1").check();
  await dialog
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(state.tasks[0]).toMatchObject({
    title: "Write the brief",
    category: "Studio",
    priority: "high",
    status: "in_progress",
    estimated_minutes: 90,
    actual_minutes: 15,
    reminder_minutes: 30,
    tags: ["focus", "launch"],
    subtasks: [{ title: "Outline", completed: true }],
  });
  expect(state.tasks[0].start_at).toMatch(/Z$/);
  expect(state.tasks[0].due_at).toMatch(/Z$/);
  await page.getByLabel("Search tasks").fill("not found");
  await expect(page.getByText("A little too filtered.")).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit Write the brief" }).click();
  await dialog.getByLabel("Task title", { exact: true }).fill("Updated brief");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.tasks[0].title).toBe("Updated brief");
  await page.getByRole("button", { name: "Edit Updated brief" }).click();
  await dialog
    .getByRole("button", { name: "Delete task", exact: true })
    .click();
  expect(state.tasks).toHaveLength(1);
  await dialog.getByRole("button", { name: "Yes, delete task" }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.tasks).toHaveLength(0);
});

test("Kanban status select and drag/drop persist server changes", async ({
  page,
}) => {
  const state = await workspace(page, true);
  await page.goto("/kanban");
  await page
    .getByLabel("Status of Integration task")
    .selectOption("in_progress");
  await expect(page.getByLabel("Status of Integration task")).toHaveValue(
    "in_progress",
  );
  expect(state.tasks[0].status).toBe("in_progress");
  await page
    .locator(".kanban-card")
    .dragTo(page.locator(".kanban-column").nth(2));
  await expect(page.getByLabel("Status of Integration task")).toHaveValue(
    "completed",
  );
  expect(state.tasks[0].status).toBe("completed");
});

test("calendar changes require review and confirmation and surface conflicts", async ({
  page,
}) => {
  const state = await workspace(page, true);
  await page.goto("/calendar");
  await page
    .getByRole("button", { name: "Schedule time", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Task", exact: true })
    .selectOption(state.tasks[0].id);
  await dialog.getByLabel("Starts", { exact: true }).fill("2026-11-02T09:00");
  await dialog.getByLabel("Ends", { exact: true }).fill("2026-11-02T10:00");
  await dialog.getByRole("button", { name: "Review schedule" }).click();
  expect(state.writes.filter((w) => w.path === "/schedules")).toHaveLength(0);
  await dialog.getByRole("button", { name: "Confirm schedule" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Schedule conflict");
  expect(state.writes.filter((w) => w.path === "/schedules")).toHaveLength(1);
});

test("assistant proposes without saving, then confirms and refreshes actual tasks", async ({
  page,
}) => {
  const state = await workspace(page);
  await page.goto("/assistant");
  await page.getByLabel("Message Kazi assistant").fill("Plan a task");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("PROPOSED, NOT YET SAVED")).toBeVisible();
  expect(state.tasks).toHaveLength(0);
  expect(state.confirmed).toBe(0);
  await page.getByRole("button", { name: "Confirm & apply" }).click();
  await expect(
    page.getByText("SAVED TO YOUR WORKSPACE", { exact: true }),
  ).toBeVisible();
  expect(state.confirmed).toBe(1);
  expect(state.tasks[0].title).toBe("Proposed task");
  await page.getByRole("link", { name: "My tasks" }).click();
  await expect(
    page.getByRole("button", { name: "Edit Proposed task" }),
  ).toBeVisible();
});

test("projects and notes CRUD, note conversion, and profile persistence", async ({
  page,
}) => {
  const state = await workspace(page);
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("Launch project");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Launch project" }),
  ).toBeVisible();
  expect(state.projects).toHaveLength(1);
  await page.getByRole("button", { name: "Edit Launch project" }).click();
  await page.getByLabel("Project name").fill("Updated project");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated project" }),
  ).toBeVisible();
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Launch thoughts");
  await page.getByLabel("Your note").fill("Plan the launch");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(
    page.getByRole("button", { name: "Launch thoughts", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Make actionable" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Create a focused next step",
  );
  expect(state.confirmed).toBe(0);
  await page.getByRole("button", { name: "Confirm & apply" }).click();
  await expect(
    page.getByText("SAVED TO YOUR WORKSPACE", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Launch thoughts", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Updated thoughts");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(
    page.getByRole("button", { name: "Updated thoughts", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Updated thoughts", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.notes).toHaveLength(0);
  await page.goto("/settings");
  await page.getByLabel("Your name").fill("Updated Tester");
  await page
    .getByRole("combobox", { name: /Timezone/ })
    .selectOption("Europe/London");
  await page.getByLabel("Enable task notifications").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated Tester", exact: true }),
  ).toBeVisible();
  expect(state.writes.find((w) => w.path === "/auth/me")?.body).toEqual({
    name: "Updated Tester",
    timezone: "Europe/London",
    notifications_enabled: false,
  });
});

test("mobile navigation, theme persistence and modal keyboard access", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "My tasks" }).click();
  await expect(
    page.getByRole("heading", { name: "My tasks", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeFocused();
});

test("unauthenticated sessions redirect to login and auth errors stay actionable", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Authentication required" }),
    }),
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Invalid email or password" }),
    }),
  );
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email address").fill("tester@example.test");
  await page.getByLabel("Password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Sign in to your workspace" }).click();
  await expect(page.locator(".error-box")).toContainText(
    "Invalid email or password",
  );
  await expect(page).toHaveURL(/\/login$/);
});
