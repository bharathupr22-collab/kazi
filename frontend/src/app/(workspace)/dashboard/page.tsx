"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  Clock3,
  Plus,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "@/providers/workspace-provider";
import { dayKey, formatDate } from "@/lib/dates";
import type { Task } from "@/types";
import { Empty, PageHeading } from "@/components/ui/primitives";
import { TaskRow } from "@/components/tasks/task-list";
import { TaskEditor } from "@/components/tasks/task-editor";
import {
  CompletionChart,
  MetricCards,
} from "@/components/analytics/analytics-view";
import { ProjectCard } from "@/components/projects/projects-view";
export default function Dashboard() {
  const { user, tasks, projects, schedules, analytics } = useWorkspace();
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  const [tab, setTab] = useState("focus");
  const today = dayKey(new Date(), user.timezone);
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: user.timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const focus = tasks
    .filter((t) => t.status !== "completed")
    .sort(
      (a, b) =>
        (a.due_at ? new Date(a.due_at).getTime() : Infinity) -
        (b.due_at ? new Date(b.due_at).getTime() : Infinity),
    );
  const visible = (
    tab === "today"
      ? focus.filter(
          (t) => t.due_at && dayKey(t.due_at, user.timezone) === today,
        )
      : tab === "done"
        ? tasks.filter((t) => t.status === "completed")
        : focus
  ).slice(0, 5);
  const blocks = schedules.filter(
    (s) =>
      dayKey(s.start_at, user.timezone) === today ||
      (new Date(s.start_at) < new Date() && new Date(s.end_at) > new Date()),
  );
  return (
    <>
      <PageHeading
        eyebrow="LET’S MAKE TODAY COUNT"
        title={`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}.`}
        description="A fresh perspective. A clear next step. You’ve got this."
        action={
          <button className="button primary" onClick={() => setEditor("new")}>
            <Plus size={17} />
            Create a task
          </button>
        }
      />
      <section className="dashboard-banner">
        <div>
          <span className="banner-label">
            <span /> YOUR SPACE TO DO GREAT THINGS
          </span>
          <h2>
            Big things happen
            <br />
            one <em>small step</em> at a time.
          </h2>
          <p>
            {tasks.length
              ? `You have ${focus.length} open ${focus.length === 1 ? "task" : "tasks"}. Pick one that moves you forward.`
              : "Clear a little headspace. Capture your first task and find your flow."}
          </p>
          <Link href="/assistant" className="button banner-button">
            <Sparkles size={16} />
            Find my focus <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="art-circle circle-one" />
          <div className="art-circle circle-two" />
          <span className="art-star">✳</span>
          <div className="art-card">
            <span className="art-check">
              <CheckCheck size={23} />
            </span>
            <div>
              <strong>Progress over perfection.</strong>
              <span>A little better, every day.</span>
            </div>
          </div>
          <span className="art-spark">✧</span>
        </div>
      </section>
      <MetricCards />
      <div className="dashboard-grid">
        <section className="panel focus-panel">
          <div className="panel-header">
            <div>
              <h2>
                Your next steps <span className="count">{focus.length}</span>
              </h2>
              <p>A little intention goes a long way.</p>
            </div>
            <Link href="/tasks" className="text-button">
              All tasks <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="focus-tabs tabs">
            <button
              className={tab === "focus" ? "selected" : ""}
              onClick={() => setTab("focus")}
            >
              Up next
            </button>
            <button
              className={tab === "today" ? "selected" : ""}
              onClick={() => setTab("today")}
            >
              Due today
            </button>
            <button
              className={tab === "done" ? "selected" : ""}
              onClick={() => setTab("done")}
            >
              Completed
            </button>
          </div>
          {visible.length ? (
            <div className="compact-task-list">
              {visible.map((task) => (
                <TaskRow key={task.id} task={task} onEdit={setEditor} />
              ))}
            </div>
          ) : (
            <Empty
              title={
                tasks.length
                  ? "A little breathing room."
                  : "Your next chapter starts here."
              }
              description={
                tasks.length
                  ? "No tasks in this view. Take a moment, or plan your next step."
                  : "Add a task and turn an intention into action."
              }
              action={
                <button
                  className="text-button"
                  onClick={() => setEditor("new")}
                >
                  <Plus size={15} />
                  Add a task
                </button>
              }
            />
          )}
          <button className="add-task-row" onClick={() => setEditor("new")}>
            <Plus size={16} />
            Capture a new task
          </button>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Your weekly rhythm</h2>
              <p>Every finish is a step forward.</p>
            </div>
            <Link
              href="/analytics"
              className="icon-button"
              aria-label="View analytics"
            >
              <ArrowUpRight size={19} />
            </Link>
          </div>
          <div className="chart-summary">
            <strong>
              {analytics
                ? analytics.weekly.reduce(
                    (total, day) => total + day.completed,
                    0,
                  )
                : "—"}
            </strong>
            <span>completions in 7 days</span>
            <span className="chart-period">This week</span>
          </div>
          <div className="chart-padding">
            <CompletionChart compact />
          </div>
        </section>
        <section className="panel projects-overview">
          <div className="panel-header">
            <div>
              <h2>The bigger picture</h2>
              <p>A little progress on what matters.</p>
            </div>
            <Link href="/projects" className="text-button">
              All projects <ArrowUpRight size={15} />
            </Link>
          </div>
          {projects.length ? (
            <div className="dashboard-projects">
              {projects.slice(0, 2).map((project) => (
                <ProjectCard project={project} key={project.id} />
              ))}
            </div>
          ) : (
            <Empty
              title="Give your ideas a home."
              description="Bring related tasks together in a project. See your progress at a glance."
              action={
                <Link className="button" href="/projects">
                  Start a project <ArrowRight size={15} />
                </Link>
              }
            />
          )}
        </section>
        <section className="panel today-panel">
          <div className="panel-header">
            <div>
              <h2>A look at today</h2>
              <p>Room for focus. Room for you.</p>
            </div>
            <CalendarDays size={19} />
          </div>
          <div className="today-agenda">
            {blocks.length ? (
              blocks.map((block) => (
                <Link href="/calendar" className="agenda-item" key={block.id}>
                  <span className="agenda-time">
                    {new Date(block.start_at).toLocaleTimeString("en", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: user.timezone,
                    })}
                  </span>
                  <div>
                    <strong>
                      {tasks.find((t) => t.id === block.task_id)?.title ||
                        block.task_title}
                    </strong>
                    <span>
                      <Clock3 size={12} />
                      {Math.round(
                        (new Date(block.end_at).getTime() -
                          new Date(block.start_at).getTime()) /
                          60000,
                      )}{" "}
                      min focus block
                    </span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="agenda-empty">
                <span className="agenda-empty-icon">
                  <CalendarDays size={24} />
                </span>
                <h3>Your day is an open canvas.</h3>
                <p>Reserve a little time for your most important work.</p>
              </div>
            )}
            <Link className="button calendar-link" href="/calendar">
              Open calendar <ArrowRight size={15} />
            </Link>
          </div>
          <div className="today-note">
            <Sparkles size={17} />
            <p>Make a plan that leaves you space to breathe.</p>
          </div>
        </section>
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
