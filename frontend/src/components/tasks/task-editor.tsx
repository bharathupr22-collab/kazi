"use client";
import { useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { Subtask, Task, TaskInput } from "@/types";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import { iso, localInput } from "@/lib/dates";
import { message } from "@/lib/api";
import { ErrorBox, Modal, SaveButton } from "@/components/ui/primitives";
export function TaskEditor({
  task,
  onClose,
  defaultProject,
  defaultDue,
}: {
  task?: Task;
  onClose: () => void;
  defaultProject?: string;
  defaultDue?: string;
}) {
  const { projects, mutate } = useWorkspace();
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>(task?.subtasks || []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const body: TaskInput = {
        title: String(data.get("title")).trim(),
        description: String(data.get("description")),
        category: String(data.get("category")).trim(),
        status: String(data.get("status")) as TaskInput["status"],
        priority: String(data.get("priority")) as TaskInput["priority"],
        start_at: iso(String(data.get("start_at"))),
        due_at: iso(String(data.get("due_at"))),
        estimated_minutes: Number(data.get("estimated_minutes")),
        actual_minutes: Number(data.get("actual_minutes")),
        reminder_minutes:
          data.get("reminder_minutes") === ""
            ? null
            : Number(data.get("reminder_minutes")),
        project_id: String(data.get("project_id")) || null,
        tags: [
          ...new Set(
            String(data.get("tags"))
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
        subtasks: subtasks.map((s) => ({ ...s, title: s.title.trim() })),
      };
      if (body.start_at && body.due_at && body.start_at > body.due_at)
        throw new Error("The due date must be after the start date.");
      if (body.tags.length > 30 || body.tags.some((t) => t.length > 50))
        throw new Error(
          "Use up to 30 tags, each no longer than 50 characters.",
        );
      await mutate(
        task ? `/tasks/${task.id}` : "/tasks",
        task ? "PATCH" : "POST",
        body,
      );
      toast(task ? "Task updated." : "Your next step is ready.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await mutate(`/tasks/${task!.id}`, "DELETE");
      toast("Task and its scheduled blocks deleted.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={task ? "Edit task" : "Make your next move"}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <ErrorBox>{error}</ErrorBox>
          <label>
            Task title
            <input
              name="title"
              defaultValue={task?.title}
              placeholder="What would you like to accomplish?"
              maxLength={200}
              required
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              defaultValue={task?.description}
              placeholder="A little context makes the next step easier…"
              rows={3}
              maxLength={20000}
            />
          </label>
          <div className="form-grid three">
            <label>
              Status
              <select name="status" defaultValue={task?.status || "todo"}>
                <option value="todo">To do</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue={task?.priority || "medium"}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Category
              <input
                name="category"
                defaultValue={task?.category || "Personal"}
                maxLength={100}
                required
                list="task-categories"
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Project
              <select
                name="project_id"
                defaultValue={task?.project_id || defaultProject || ""}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tags <span className="field-hint">comma separated</span>
              <input
                name="tags"
                defaultValue={task?.tags.join(", ")}
                placeholder="focus, planning"
              />
            </label>
          </div>
          <div className="form-section">
            <h3>Timing & intention</h3>
            <p className="field-hint">
              Times below use your device timezone:{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}. Calendar
              blocks are scheduled separately.
            </p>
            <div className="form-grid">
              <label>
                Start date & time
                <input
                  type="datetime-local"
                  name="start_at"
                  defaultValue={localInput(task?.start_at)}
                />
              </label>
              <label>
                Due date & time
                <input
                  type="datetime-local"
                  name="due_at"
                  defaultValue={localInput(task?.due_at || defaultDue)}
                />
              </label>
            </div>
            <div className="form-grid three">
              <label>
                Estimate (minutes)
                <input
                  type="number"
                  name="estimated_minutes"
                  min={0}
                  max={525600}
                  step={1}
                  required
                  defaultValue={task?.estimated_minutes ?? 30}
                />
              </label>
              <label>
                Actual (minutes)
                <input
                  type="number"
                  name="actual_minutes"
                  min={0}
                  max={525600}
                  step={1}
                  required
                  defaultValue={task?.actual_minutes ?? 0}
                />
              </label>
              <label>
                Remind before (min)
                <input
                  type="number"
                  name="reminder_minutes"
                  min={0}
                  max={525600}
                  step={1}
                  placeholder="No reminder"
                  defaultValue={task?.reminder_minutes ?? ""}
                />
              </label>
            </div>
          </div>
          <div className="form-section">
            <div className="section-heading">
              <h3>
                Small steps <span className="count">{subtasks.length}</span>
              </h3>
              <button
                type="button"
                className="text-button"
                disabled={subtasks.length >= 100}
                onClick={() =>
                  setSubtasks([
                    ...subtasks,
                    { id: crypto.randomUUID(), title: "", completed: false },
                  ])
                }
              >
                <Plus size={15} /> Add subtask
              </button>
            </div>
            {subtasks.map((subtask, index) => (
              <div className="subtask-input" key={subtask.id}>
                <input
                  type="checkbox"
                  aria-label={`Complete subtask ${index + 1}`}
                  checked={subtask.completed}
                  onChange={(e) =>
                    setSubtasks(
                      subtasks.map((s) =>
                        s.id === subtask.id
                          ? { ...s, completed: e.target.checked }
                          : s,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Subtask ${index + 1} title`}
                  placeholder="One small, actionable step"
                  value={subtask.title}
                  required
                  maxLength={200}
                  onChange={(e) =>
                    setSubtasks(
                      subtasks.map((s) =>
                        s.id === subtask.id
                          ? { ...s, title: e.target.value }
                          : s,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove subtask ${index + 1}`}
                  onClick={() =>
                    setSubtasks(subtasks.filter((s) => s.id !== subtask.id))
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
          {deleting && (
            <div className="delete-warning">
              <strong>Delete this task permanently?</strong>
              <p>
                Its scheduled blocks and notifications will also be removed.
              </p>
              <button
                className="button danger"
                type="button"
                disabled={busy}
                onClick={remove}
              >
                Yes, delete task
              </button>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => setDeleting(false)}
              >
                Keep task
              </button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {task && (
            <button
              className="text-button danger-text push-left"
              disabled={busy}
              type="button"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} />
              Delete task
            </button>
          )}
          <button
            className="button"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <SaveButton busy={busy}>
            {task ? "Save changes" : "Create task"}
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}
