"use client";
import { useState } from "react";
import { CalendarDays, GripVertical, Plus } from "lucide-react";
import type { Status, Task } from "@/types";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import { message } from "@/lib/api";
import { formatDate, statusLabel } from "@/lib/dates";
import { emptyFilters, filterTasks } from "@/lib/tasks";
import { TaskFilters } from "@/components/tasks/task-list";
import { TaskEditor } from "@/components/tasks/task-editor";
import { PageHeading } from "@/components/ui/primitives";
export function KanbanBoard() {
  const { tasks, user, mutate } = useWorkspace();
  const { toast } = useUI();
  const [filters, setFilters] = useState(emptyFilters);
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const visible = filterTasks(tasks, filters, user.timezone);
  async function move(id: string, status: Status) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status || busy) return;
    setBusy(id);
    try {
      await mutate(`/tasks/${id}`, "PATCH", { status });
      toast(`Moved to ${statusLabel[status].toLowerCase()}.`);
    } catch (e) {
      toast(message(e));
    } finally {
      setBusy(null);
      setDragging(null);
      setOver(null);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="FIND YOUR FORWARD"
        title="A little more flow"
        description="See the work. Move it forward. Celebrate every finish."
        action={
          <button className="button primary" onClick={() => setEditor("new")}>
            <Plus size={17} />
            New task
          </button>
        }
      />
      <section className="panel kanban-filters">
        <TaskFilters filters={filters} onChange={setFilters} />
      </section>
      <p className="field-hint board-hint">
        Drag cards between columns, or use each card’s status menu. Changes are
        saved to your workspace.
      </p>
      <div className="kanban-board">
        {(["todo", "in_progress", "completed"] as Status[]).map((status) => (
          <section
            key={status}
            className={`kanban-column ${over === status ? "drag-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(status);
              e.dataTransfer.dropEffect = "move";
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              void move(e.dataTransfer.getData("text/plain"), status);
              setOver(null);
            }}
          >
            <header className="kanban-column-header">
              <h2>
                <span className={`status-dot ${status}`} />
                {statusLabel[status]}{" "}
                <span className="count">
                  {visible.filter((t) => t.status === status).length}
                </span>
              </h2>
              <button
                className="icon-button"
                aria-label="Create task"
                onClick={() => setEditor("new")}
              >
                <Plus size={17} />
              </button>
            </header>
            <div className="kanban-cards">
              {visible
                .filter((t) => t.status === status)
                .map((task) => (
                  <article
                    className={`kanban-card ${dragging === task.id ? "dragging" : ""}`}
                    draggable={!busy}
                    key={task.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", task.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(task.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  >
                    <div className="kanban-card-top">
                      <span className={`badge priority-${task.priority}`}>
                        <i />
                        {task.priority}
                      </span>
                      <GripVertical size={16} className="muted" />
                    </div>
                    <button
                      className="kanban-title"
                      onClick={() => setEditor(task)}
                    >
                      {task.title}
                    </button>
                    {task.description && <p>{task.description}</p>}
                    <div className="tag-row">
                      <span className="tag">{task.category}</span>
                      {task.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="kanban-card-meta">
                      <span>
                        <CalendarDays size={13} />
                        {formatDate(task.due_at, user.timezone)}
                      </span>
                      {task.subtasks.length > 0 && (
                        <span>
                          {task.subtasks.filter((s) => s.completed).length}/
                          {task.subtasks.length} steps
                        </span>
                      )}
                    </div>
                    <select
                      aria-label={`Status of ${task.title}`}
                      value={task.status}
                      disabled={busy !== null}
                      onChange={(e) => move(task.id, e.target.value as Status)}
                    >
                      {Object.entries(statusLabel).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
              {!visible.some((t) => t.status === status) && (
                <div className="column-empty">
                  <span>Room for your next step.</span>
                  <small>
                    {tasks.length
                      ? "Move a task here or adjust filters."
                      : "Add a task to get started."}
                  </small>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
      {editor && (
        <TaskEditor
          task={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
