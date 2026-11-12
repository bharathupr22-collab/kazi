"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import type { Project, ProjectInput } from "@/types";
import { iso, localInput, formatDate } from "@/lib/dates";
import { message } from "@/lib/api";
import {
  Empty,
  ErrorBox,
  Modal,
  PageHeading,
  Progress,
  SaveButton,
} from "@/components/ui/primitives";
function ProjectEditor({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const { mutate } = useWorkspace();
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const body: ProjectInput = {
        name: String(data.get("name")).trim(),
        description: String(data.get("description")),
        status: String(data.get("status")) as ProjectInput["status"],
        priority: String(data.get("priority")) as ProjectInput["priority"],
        start_at: iso(String(data.get("start_at"))),
        deadline: iso(String(data.get("deadline"))),
      };
      if (body.start_at && body.deadline && body.start_at > body.deadline)
        throw new Error("The deadline cannot precede the start date.");
      await mutate(
        project ? `/projects/${project.id}` : "/projects",
        project ? "PATCH" : "POST",
        body,
      );
      toast(
        project ? "Project updated." : "A new project, a fresh possibility.",
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
      await mutate(`/projects/${project!.id}`, "DELETE");
      toast("Project deleted. Its tasks have been kept.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={project ? "Edit project" : "Start something meaningful"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        <div className="modal-body form-stack">
          <ErrorBox>{error}</ErrorBox>
          <label>
            Project name
            <input
              name="name"
              required
              maxLength={200}
              defaultValue={project?.name}
              placeholder="Give your next big thing a name"
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              maxLength={20000}
              rows={4}
              defaultValue={project?.description}
            />
          </label>
          <div className="form-grid">
            <label>
              Status
              <select name="status" defaultValue={project?.status || "active"}>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label>
              Priority
              <select
                name="priority"
                defaultValue={project?.priority || "medium"}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <p className="field-hint">
            Dates use your device timezone:{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}.
          </p>
          <div className="form-grid">
            <label>
              Start date
              <input
                name="start_at"
                type="datetime-local"
                defaultValue={localInput(project?.start_at)}
              />
            </label>
            <label>
              Deadline
              <input
                name="deadline"
                type="datetime-local"
                defaultValue={localInput(project?.deadline)}
              />
            </label>
          </div>
          {deleting && (
            <div className="delete-warning">
              <strong>Delete this project?</strong>
              <p>
                Your tasks will be preserved and detached from this project.
              </p>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={remove}
              >
                Delete project
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setDeleting(false)}
              >
                Keep project
              </button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {project && (
            <button
              type="button"
              className="text-button danger-text push-left"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <SaveButton busy={busy}>
            {project ? "Save changes" : "Create project"}
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}
export function ProjectCard({
  project,
  onEdit,
}: {
  project: Project;
  onEdit?: (project: Project) => void;
}) {
  const { user } = useWorkspace();
  return (
    <article className="project-card">
      <div className="project-top">
        <span className="project-icon">
          <FolderOpen size={21} />
        </span>
        <span
          className={`badge ${project.status === "completed" ? "success" : "neutral"}`}
        >
          {project.status.replaceAll("_", " ")}
        </span>
        {onEdit && (
          <button
            className="icon-button"
            aria-label={`Edit ${project.name}`}
            onClick={() => onEdit(project)}
          >
            <MoreHorizontal size={20} />
          </button>
        )}
      </div>
      <h3>{project.name}</h3>
      <p className="project-description">
        {project.description || "A space for your next meaningful achievement."}
      </p>
      <div className="progress-label">
        <span>Task progress</span>
        <strong>{Math.round(project.progress)}%</strong>
      </div>
      <Progress value={project.progress} />
      <div className="project-bottom">
        <span>
          {project.completed_count}/{project.task_count} tasks done
        </span>
        <span>
          <CalendarDays size={13} />
          {formatDate(project.deadline, user.timezone)}
        </span>
      </div>
      <div className="project-card-footer">
        <span className={`badge priority-${project.priority}`}>
          {project.priority} priority
        </span>
        <Link href={`/tasks?project=${project.id}`} className="text-button">
          View tasks <ArrowUpRight size={14} />
        </Link>
      </div>
    </article>
  );
}
export function ProjectsPage() {
  const { projects } = useWorkspace();
  const [editor, setEditor] = useState<Project | "new" | null>(null);
  const [filter, setFilter] = useState("all");
  const visible = projects.filter(
    (p) => filter === "all" || p.status === filter,
  );
  return (
    <>
      <PageHeading
        eyebrow="THE BIGGER PICTURE"
        title="Your projects"
        description="Give your ambitions a home. Make progress, piece by piece."
        action={
          <button className="button primary" onClick={() => setEditor("new")}>
            <Plus size={17} />
            New project
          </button>
        }
      />
      <div className="view-toolbar">
        <div className="tabs" aria-label="Project status">
          {[
            ["all", "All projects"],
            ["active", "Active"],
            ["on_hold", "On hold"],
            ["completed", "Completed"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "selected" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted">{visible.length} projects</span>
      </div>
      {visible.length ? (
        <div className="project-grid">
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onEdit={setEditor}
            />
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title={
              projects.length
                ? "Nothing in this chapter yet."
                : "Big ideas deserve a plan."
            }
            description="Create a project, add a few tasks, and watch the pieces come together."
            action={
              <button
                className="button primary"
                onClick={() => setEditor("new")}
              >
                Create a project
              </button>
            }
          />
        </section>
      )}
      {editor && (
        <ProjectEditor
          project={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
