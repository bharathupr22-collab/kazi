"use client";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { Task } from "@/types";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import { message } from "@/lib/api";
import { formatDate, statusLabel } from "@/lib/dates";
import { emptyFilters, filterTasks, type Filters } from "@/lib/tasks";
import { Empty, PageHeading } from "@/components/ui/primitives";
import { TaskEditor } from "./task-editor";
export function TaskRow({
  task,
  onEdit,
}: {
  task: Task;
  onEdit: (task: Task) => void;
}) {
  const { user, projects, mutate } = useWorkspace();
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const overdue =
    task.due_at &&
    new Date(task.due_at) < new Date() &&
    task.status !== "completed";
  async function toggle() {
    setBusy(true);
    try {
      await mutate(`/tasks/${task.id}`, "PATCH", {
        status: task.status === "completed" ? "todo" : "completed",
      });
    } catch (e) {
      toast(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`task-row ${task.status === "completed" ? "is-completed" : ""}`}
    >
      <button
        className={`task-check ${task.status === "completed" ? "checked" : ""}`}
        disabled={busy}
        aria-label={
          task.status === "completed"
            ? `Reopen ${task.title}`
            : `Complete ${task.title}`
        }
        onClick={toggle}
      >
        {task.status === "completed" ? <Check size={13} /> : null}
      </button>
      <button className="task-title-button" onClick={() => onEdit(task)}>
        <strong>{task.title}</strong>
        <span>
          {projects.find((p) => p.id === task.project_id)?.name ||
            task.category}
          {task.subtasks.length > 0 && (
            <>
              {" "}
              · {task.subtasks.filter((s) => s.completed).length}/
              {task.subtasks.length} steps
            </>
          )}
        </span>
      </button>
      <span className={`badge priority-${task.priority}`}>
        <i />
        {task.priority}
      </span>
      <span className="task-status">
        <span className={`status-dot ${task.status}`} />
        {statusLabel[task.status]}
      </span>
      <span className={`task-date ${overdue ? "overdue" : ""}`}>
        <CalendarDays size={13} />
        {task.due_at ? formatDate(task.due_at, user.timezone) : "Unscheduled"}
      </span>
      <button
        className="icon-button row-edit"
        aria-label={`Edit ${task.title}`}
        onClick={() => onEdit(task)}
      >
        <SlidersHorizontal size={15} />
      </button>
    </div>
  );
}
export function TaskFilters({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  const { tasks, projects } = useWorkspace();
  const set = (key: keyof Filters, value: string) =>
    onChange({ ...filters, [key]: value });
  return (
    <div className="filters">
      <div className="search-field">
        <Search size={17} />
        <input
          aria-label="Search tasks"
          placeholder="Find a task, tag, or idea…"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
        />
      </div>
      <select
        aria-label="Filter priority"
        value={filters.priority}
        onChange={(e) => set("priority", e.target.value)}
      >
        <option value="">All priorities</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <select
        aria-label="Filter status"
        value={filters.status}
        onChange={(e) => set("status", e.target.value)}
      >
        <option value="">All statuses</option>
        <option value="todo">To do</option>
        <option value="in_progress">In progress</option>
        <option value="completed">Completed</option>
      </select>
      <select
        aria-label="Filter category"
        value={filters.category}
        onChange={(e) => set("category", e.target.value)}
      >
        <option value="">All categories</option>
        {[...new Set(tasks.map((t) => t.category))].sort().map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select
        aria-label="Filter due date"
        value={filters.due}
        onChange={(e) => set("due", e.target.value)}
      >
        <option value="">Any due date</option>
        <option value="today">Due today</option>
        <option value="week">Next 7 days</option>
        <option value="overdue">Overdue</option>
        <option value="none">No due date</option>
      </select>
      <select
        aria-label="Filter project"
        value={filters.project}
        onChange={(e) => set("project", e.target.value)}
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {Object.values(filters).some(Boolean) && (
        <button className="text-button" onClick={() => onChange(emptyFilters)}>
          Clear
        </button>
      )}
    </div>
  );
}
export function TasksPage() {
  const { tasks, user } = useWorkspace();
  const [filters, setFilters] = useState(emptyFilters);
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  useEffect(() => {
    const project = new URLSearchParams(window.location.search).get("project");
    if (project) setFilters((previous) => ({ ...previous, project }));
  }, []);
  const visible = filterTasks(tasks, filters, user.timezone);
  return (
    <>
      <PageHeading
        eyebrow="ONE STEP AT A TIME"
        title="My tasks"
        description="Turn a busy mind into a clear, achievable plan."
        action={
          <button className="button primary" onClick={() => setEditor("new")}>
            <Plus size={17} />
            New task
          </button>
        }
      />
      <div className="mini-stats">
        <span>
          <Circle size={16} />
          <strong>{tasks.filter((t) => t.status === "todo").length}</strong> to
          do
        </span>
        <span>
          <Clock3 size={16} />
          <strong>
            {tasks.filter((t) => t.status === "in_progress").length}
          </strong>{" "}
          in progress
        </span>
        <span>
          <CheckCircle2 size={16} />
          <strong>
            {tasks.filter((t) => t.status === "completed").length}
          </strong>{" "}
          completed
        </span>
      </div>
      <section className="panel">
        <TaskFilters filters={filters} onChange={setFilters} />
        <div className="list-heading">
          <span>TASK / PROJECT</span>
          <span>PRIORITY</span>
          <span>STATUS</span>
          <span>DUE DATE</span>
        </div>
        {visible.length ? (
          visible.map((task) => (
            <TaskRow key={task.id} task={task} onEdit={setEditor} />
          ))
        ) : (
          <Empty
            title={
              tasks.length
                ? "A little too filtered."
                : "Great work starts with one task."
            }
            description={
              tasks.length
                ? "Try another search or clear your filters."
                : "Capture what’s on your mind. We’ll help you find your flow."
            }
            action={
              <button
                className="button primary"
                onClick={() =>
                  tasks.length ? setFilters(emptyFilters) : setEditor("new")
                }
              >
                {tasks.length ? "Clear filters" : "Create your first task"}
              </button>
            }
          />
        )}
        <div className="panel-bottom">
          {visible.length} of {tasks.length} tasks · Dates in {user.timezone}
        </div>
      </section>
      {editor && (
        <TaskEditor
          task={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
