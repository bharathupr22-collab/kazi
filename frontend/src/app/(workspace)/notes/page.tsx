"use client";
import { useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import { api, json, message } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import type { ChatReply, Note } from "@/types";
import {
  Empty,
  ErrorBox,
  Modal,
  PageHeading,
  SaveButton,
} from "@/components/ui/primitives";
import { ProposalCard } from "@/components/assistant/assistant-view";
function NoteEditor({ note, onClose }: { note?: Note; onClose: () => void }) {
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
      await mutate(
        note ? `/notes/${note.id}` : "/notes",
        note ? "PATCH" : "POST",
        {
          title: String(data.get("title")).trim(),
          content: String(data.get("content")),
        },
      );
      toast(
        note
          ? "Your note is up to date."
          : "Idea captured. Headspace reclaimed.",
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
      await mutate(`/notes/${note!.id}`, "DELETE");
      toast("Note deleted.");
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={note ? "A little room to think" : "Capture a little inspiration"}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        <div className="modal-body form-stack">
          <ErrorBox>{error}</ErrorBox>
          <label>
            Title
            <input
              name="title"
              defaultValue={note?.title}
              required
              maxLength={200}
              placeholder="What’s on your mind?"
            />
          </label>
          <label>
            Your note
            <textarea
              className="note-textarea"
              name="content"
              rows={12}
              maxLength={20000}
              defaultValue={note?.content}
              placeholder="An idea, a plan, a thought worth keeping…"
            />
          </label>
          {deleting && (
            <div className="delete-warning">
              <strong>Delete this note permanently?</strong>
              <p>This can’t be undone.</p>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={remove}
              >
                Delete note
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setDeleting(false)}
              >
                Keep note
              </button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {note && (
            <button
              type="button"
              disabled={busy}
              className="text-button danger-text push-left"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} />
              Delete
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <SaveButton busy={busy}>Save note</SaveButton>
        </div>
      </form>
    </Modal>
  );
}
export default function NotesPage() {
  const { notes, user } = useWorkspace();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Note | "new" | null>(null);
  const [converting, setConverting] = useState<string | null>(null);
  const [reply, setReply] = useState<ChatReply | null>(null);
  const [error, setError] = useState("");
  const visible = notes.filter((n) =>
    `${n.title} ${n.content}`.toLowerCase().includes(search.toLowerCase()),
  );
  async function convert(note: Note) {
    setConverting(note.id);
    setError("");
    try {
      setReply(await api<ChatReply>(`/notes/${note.id}/convert`, json("POST")));
    } catch (e) {
      setError(message(e));
    } finally {
      setConverting(null);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="DON’T LOSE THAT THOUGHT"
        title="Notes & little sparks"
        description="A home for the thoughts that aren’t quite tasks. Yet."
        action={
          <button className="button primary" onClick={() => setEditor("new")}>
            <Plus size={17} />
            New note
          </button>
        }
      />
      <div className="view-toolbar">
        <div className="search-field note-search">
          <Search size={17} />
          <input
            aria-label="Search notes"
            placeholder="Find a thought…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="muted">{visible.length} notes</span>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div className="privacy-note">
        <Sparkles size={15} />
        <span>
          Turn a note into a task proposal with Kazi. Review and confirm before
          anything is created. Relevant workspace content is shared with the
          configured AI provider.
        </span>
      </div>
      {visible.length ? (
        <div className="notes-grid">
          {visible.map((note, i) => (
            <article key={note.id} className={`note-card note-color-${i % 3}`}>
              <div className="note-card-top">
                <StickyNote size={19} />
                <span>{formatDate(note.updated_at, user.timezone)}</span>
              </div>
              <button className="note-title" onClick={() => setEditor(note)}>
                {note.title}
              </button>
              <p className="note-preview">
                {note.content || "A blank page, full of possibility."}
              </p>
              <div className="note-card-footer">
                <button className="text-button" onClick={() => setEditor(note)}>
                  Open note <ArrowUpRight size={14} />
                </button>
                <button
                  className="text-button"
                  disabled={converting !== null}
                  onClick={() => convert(note)}
                >
                  {converting === note.id ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Make actionable
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title={
              notes.length
                ? "That thought is still out there."
                : "Your ideas deserve a little space."
            }
            description={
              notes.length
                ? "Try a different search."
                : "Capture a thought, sketch out a plan, or save something for later."
            }
            action={
              <button
                className="button primary"
                onClick={() => setEditor("new")}
              >
                Write a note
              </button>
            }
          />
        </section>
      )}
      {editor && (
        <NoteEditor
          note={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}{" "}
      {reply && (
        <Modal title="From idea to action" wide onClose={() => setReply(null)}>
          <div className="modal-body">
            <p className="conversion-reply">{reply.reply}</p>
            {reply.proposal && <ProposalCard proposal={reply.proposal} />}
          </div>
        </Modal>
      )}
    </>
  );
}
