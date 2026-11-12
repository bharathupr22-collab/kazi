"use client";
import { useState, type FormEvent } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  Trash2,
} from "lucide-react";
import type { Schedule, Task } from "@/types";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import { addDays, dayKey, formatDate, localInput } from "@/lib/dates";
import { message } from "@/lib/api";
import {
  Empty,
  ErrorBox,
  Modal,
  PageHeading,
} from "@/components/ui/primitives";
import { TaskEditor } from "@/components/tasks/task-editor";
type ScheduleDraft = { task_id: string; start_at: string; end_at: string };
function ScheduleEditor({
  schedule,
  date,
  onClose,
}: {
  schedule?: Schedule;
  date: Date;
  onClose: () => void;
}) {
  const { tasks, mutate } = useWorkspace();
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<ScheduleDraft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const start = new Date(date);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    try {
      const draft = {
        task_id: schedule?.task_id || String(data.get("task_id")),
        start_at: new Date(String(data.get("start_at"))).toISOString(),
        end_at: new Date(String(data.get("end_at"))).toISOString(),
      };
      if (draft.end_at <= draft.start_at)
        throw new Error("The end time must be after the start time.");
      if (
        new Date(draft.end_at).getTime() - new Date(draft.start_at).getTime() >
        7 * 86400000
      )
        throw new Error("A scheduled block cannot exceed seven days.");
      setReview(draft);
    } catch (e) {
      setError(message(e));
    }
  }
  async function save() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const { task_id, ...times } = review;
      await mutate(
        schedule ? `/schedules/${schedule.id}` : "/schedules",
        schedule ? "PATCH" : "POST",
        schedule ? times : review,
      );
      toast(
        schedule
          ? "Schedule change confirmed."
          : "Time set aside. Make it count.",
      );
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await mutate(`/schedules/${schedule!.id}`, "DELETE");
      toast("Scheduled block removed. Your task is unchanged.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        schedule ? "Reschedule a focus block" : "Make room for focused work"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-body">
        <ErrorBox>{error}</ErrorBox>
        {review ? (
          <div className="schedule-review">
            <span className="eyebrow">REVIEW BEFORE SAVING</span>
            <h3>{tasks.find((t) => t.id === review.task_id)?.title}</h3>
            <p>
              <Clock3 size={17} />
              {formatDate(review.start_at, undefined, true)} →{" "}
              {formatDate(review.end_at, undefined, true)}
            </p>
            <p className="muted">
              Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
              Nothing changes until you confirm. Overlapping blocks will be
              rejected by the server.
            </p>
            <div className="modal-footer inline-footer">
              <button
                className="button"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Back to editing
              </button>
              <button className="button primary" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Confirm schedule"}
              </button>
            </div>
          </div>
        ) : (
          <form className="form-stack" onSubmit={prepare}>
            <label>
              Task
              <select
                name="task_id"
                required
                defaultValue={schedule?.task_id || ""}
                disabled={!!schedule}
              >
                <option value="" disabled>
                  Choose a task
                </option>
                {tasks
                  .filter(
                    (t) =>
                      t.status !== "completed" || t.id === schedule?.task_id,
                  )
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                      {task.status === "completed"
                        ? " (completed — reopen to schedule)"
                        : ""}
                    </option>
                  ))}
              </select>
            </label>
            <p className="field-hint">
              Times use your device timezone:{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}. Create a task
              first if you haven’t captured it yet.
            </p>
            <div className="form-grid">
              <label>
                Starts
                <input
                  type="datetime-local"
                  name="start_at"
                  defaultValue={localInput(
                    schedule?.start_at || start.toISOString(),
                  )}
                  required
                />
              </label>
              <label>
                Ends
                <input
                  type="datetime-local"
                  name="end_at"
                  defaultValue={localInput(
                    schedule?.end_at || end.toISOString(),
                  )}
                  required
                />
              </label>
            </div>
            <div className="modal-footer inline-footer">
              {schedule && (
                <button
                  type="button"
                  className="text-button danger-text push-left"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              )}
              <button className="button primary" type="submit">
                Review schedule →
              </button>
            </div>
          </form>
        )}
        {deleting && !review && (
          <div className="delete-warning">
            <strong>Remove this scheduled block?</strong>
            <p>The task and its deadline will stay intact.</p>
            <button className="button danger" disabled={busy} onClick={remove}>
              Confirm removal
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => setDeleting(false)}
            >
              Keep block
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
export function CalendarView() {
  const { tasks, schedules } = useWorkspace();
  const [view, setView] = useState<"day" | "week" | "month">("month");
  const [date, setDate] = useState(new Date());
  const [scheduleEditor, setScheduleEditor] = useState<Schedule | "new" | null>(
    null,
  );
  const [taskEditor, setTaskEditor] = useState<Task | "new" | null>(null);
  const [selected, setSelected] = useState(new Date());
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthStart = addDays(first, -((first.getDay() + 6) % 7));
  const weekStart = addDays(date, -((date.getDay() + 6) % 7));
  const days = Array.from(
    { length: view === "month" ? 42 : view === "week" ? 7 : 1 },
    (_, i) =>
      addDays(
        view === "month" ? monthStart : view === "week" ? weekStart : date,
        i,
      ),
  );
  function navigate(direction: number) {
    if (view === "month")
      setDate(new Date(date.getFullYear(), date.getMonth() + direction, 1));
    else setDate(addDays(date, direction * (view === "week" ? 7 : 1)));
  }
  function blocks(day: Date) {
    const from = new Date(day);
    from.setHours(0, 0, 0, 0);
    const to = addDays(from, 1);
    return schedules.filter(
      (s) => new Date(s.start_at) < to && new Date(s.end_at) > from,
    );
  }
  return (
    <>
      <PageHeading
        eyebrow="PROTECT YOUR TIME"
        title="A little space to focus"
        description="A real-world rhythm for your tasks, deadlines, and deep work."
        action={
          <>
            <button className="button" onClick={() => setTaskEditor("new")}>
              <Plus size={16} />
              New task
            </button>
            <button
              className="button primary"
              onClick={() => {
                setSelected(date);
                setScheduleEditor("new");
              }}
            >
              <CalendarDays size={16} />
              Schedule time
            </button>
          </>
        }
      />
      <div className="panel calendar-panel">
        <div className="calendar-toolbar">
          <div className="calendar-navigation">
            <button
              className="icon-button"
              aria-label={`Previous ${view}`}
              onClick={() => navigate(-1)}
            >
              <ChevronLeft size={19} />
            </button>
            <h2>
              {date.toLocaleDateString("en", {
                month: "long",
                year: "numeric",
                ...(view === "day" ? { day: "numeric" } : {}),
              })}
            </h2>
            <button
              className="icon-button"
              aria-label={`Next ${view}`}
              onClick={() => navigate(1)}
            >
              <ChevronRight size={19} />
            </button>
            <button
              className="button small"
              onClick={() => setDate(new Date())}
            >
              Today
            </button>
          </div>
          <div className="tabs">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                className={view === v ? "selected" : ""}
                key={v}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="calendar-info">
          <span>
            <i className="legend-dot" />
            Scheduled block
          </span>
          <span>
            <i className="legend-dot deadline-dot" />
            Task deadline
          </span>
          <span className="push-right">Times in {deviceZone}</span>
        </div>
        <div className="calendar-scroll">
          <div className={`calendar-grid ${view}-view`}>
            {days.map((day) => {
              const dayBlocks = blocks(day);
              const deadlines = tasks.filter(
                (t) => t.due_at && dayKey(t.due_at) === dayKey(day),
              );
              const today = dayKey(day) === dayKey(new Date());
              return (
                <div
                  key={dayKey(day)}
                  className={`calendar-day ${day.getMonth() !== date.getMonth() ? "outside-month" : ""} ${today ? "is-today" : ""}`}
                >
                  <header>
                    <span className="calendar-weekday">
                      {day.toLocaleDateString("en", { weekday: "short" })}
                    </span>
                    <button
                      className="day-number"
                      aria-label={`Schedule on ${day.toLocaleDateString()}`}
                      onClick={() => {
                        setSelected(day);
                        setScheduleEditor("new");
                      }}
                    >
                      {day.getDate()}
                    </button>
                  </header>
                  <div className="calendar-events">
                    {dayBlocks.map((block) => (
                      <button
                        className="calendar-event"
                        key={block.id}
                        onClick={() => {
                          setSelected(day);
                          setScheduleEditor(block);
                        }}
                      >
                        <span>
                          {new Date(block.start_at).toLocaleTimeString("en", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        <strong>
                          {tasks.find((t) => t.id === block.task_id)?.title ||
                            block.task_title}
                        </strong>
                        {view !== "month" && (
                          <small>
                            Until {formatDate(block.end_at, undefined, true)}
                          </small>
                        )}
                      </button>
                    ))}
                    {deadlines.map((task) => (
                      <button
                        key={task.id}
                        className={`calendar-event deadline ${task.status === "completed" ? "completed-event" : ""}`}
                        onClick={() => setTaskEditor(task)}
                      >
                        <span>
                          Due ·{" "}
                          {new Date(task.due_at!).toLocaleTimeString("en", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        <strong>{task.title}</strong>
                      </button>
                    ))}
                    {view === "day" &&
                      dayBlocks.length === 0 &&
                      deadlines.length === 0 && (
                        <Empty
                          title="A little breathing room."
                          description="Choose a task and reserve a focus block for today."
                        />
                      )}
                  </div>
                  {view !== "month" && (
                    <button
                      className="text-button add-calendar-block"
                      onClick={() => {
                        setSelected(day);
                        setScheduleEditor("new");
                      }}
                    >
                      <Plus size={13} />
                      Schedule
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel-bottom">
          Click a block to review a reschedule. Click a deadline to edit the
          task. All changes require saving or confirmation.
        </div>
      </div>
      {scheduleEditor && (
        <ScheduleEditor
          schedule={scheduleEditor === "new" ? undefined : scheduleEditor}
          date={selected}
          onClose={() => setScheduleEditor(null)}
        />
      )}{" "}
      {taskEditor && (
        <TaskEditor
          task={taskEditor === "new" ? undefined : taskEditor}
          onClose={() => setTaskEditor(null)}
        />
      )}
    </>
  );
}
