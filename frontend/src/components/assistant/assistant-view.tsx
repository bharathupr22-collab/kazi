"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  Check,
  CheckCircle2,
  Clock3,
  ListTodo,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { api, json, message } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import type { ChatReply, Proposal } from "@/types";
import { ErrorBox, PageHeading } from "@/components/ui/primitives";
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { mutate, tasks, user } = useWorkspace();
  const { toast } = useUI();
  const [status, setStatus] = useState(proposal.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await mutate(`/assistant/proposals/${proposal.id}/confirm`, "POST");
      setStatus("confirmed");
      toast("Proposal confirmed. Your workspace is up to date.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`proposal-card ${status === "confirmed" ? "proposal-confirmed" : ""}`}
    >
      <div className="proposal-title">
        <span className="proposal-icon">
          {status === "confirmed" ? (
            <CheckCircle2 size={19} />
          ) : (
            <ShieldCheck size={19} />
          )}
        </span>
        <div>
          <span className="eyebrow">
            {status === "confirmed"
              ? "SAVED TO YOUR WORKSPACE"
              : status === "dismissed"
                ? "DISMISSED — NOTHING SAVED"
                : "PROPOSED, NOT YET SAVED"}
          </span>
          <h3>{proposal.summary}</h3>
        </div>
      </div>
      <div className="proposal-actions">
        {proposal.actions.map((action, i) => (
          <article className="proposal-action" key={i}>
            {action.type === "create_task" ? (
              <>
                <ListTodo size={17} />
                <div>
                  <strong>Create task: {action.task.title}</strong>
                  <p>{action.task.description || "No description"}</p>
                  <span>
                    {action.task.priority} priority ·{" "}
                    {action.task.estimated_minutes} min · {action.task.category}
                  </span>
                  <details>
                    <summary>Review all task fields</summary>
                    <pre>{JSON.stringify(action.task, null, 2)}</pre>
                  </details>
                </div>
              </>
            ) : (
              <>
                <Clock3 size={17} />
                <div>
                  <strong>
                    Schedule:{" "}
                    {tasks.find((t) => t.id === action.task_id)?.title ||
                      "Existing task"}
                  </strong>
                  <p>
                    {formatDate(action.start_at, user.timezone, true)} →{" "}
                    {formatDate(action.end_at, user.timezone, true)}
                  </p>
                  <span>{user.timezone}</span>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      <ErrorBox>{error}</ErrorBox>
      {status === "pending" && (
        <div className="proposal-footer">
          <p>Confirming saves every action above. Review the details first.</p>
          <div>
            <button
              className="button"
              disabled={busy}
              onClick={() => setStatus("dismissed")}
            >
              <X size={15} />
              Dismiss
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={confirm}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Check size={15} />
              )}{" "}
              {busy ? "Confirming…" : "Confirm & apply"}
            </button>
          </div>
        </div>
      )}
      {status === "confirmed" && (
        <div className="proposal-saved">
          <Check size={16} />
          Confirmed and refreshed from the server.
        </div>
      )}
    </div>
  );
}
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposal?: Proposal | null;
}
const suggestions = [
  "Help me prioritize my unfinished tasks",
  "Find time for focused work this week",
  "Break down a task into smaller steps",
];
export function AssistantView() {
  const { user } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length)
      end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);
  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    setError("");
    setBusy(true);
    setMessages((previous) => [
      ...previous,
      { id: crypto.randomUUID(), role: "user", content: text.trim() },
    ]);
    try {
      const reply = await api<ChatReply>(
        "/assistant/chat",
        json("POST", { message: text.trim() }),
      );
      setMessages((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply.reply,
          proposal: reply.proposal,
        },
      ]);
    } catch (e) {
      setError(message(e));
      setInput(text);
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }
  return (
    <>
      <PageHeading
        eyebrow="A THOUGHTFUL SECOND PAIR OF EYES"
        title="Meet your momentum."
        description="Your actual workspace, a fresh perspective, and you in control."
        action={
          <span className="badge success">
            <ShieldCheck size={13} />
            Confirmation-first AI
          </span>
        }
      />
      <section className="assistant-workspace panel">
        <div className="assistant-conversation" aria-live="polite">
          {messages.length === 0 && (
            <div className="assistant-welcome">
              <div className="assistant-glyph">
                <Sparkles size={35} />
              </div>
              <span className="eyebrow">
                LESS MENTAL CLUTTER. MORE CLARITY.
              </span>
              <h2>What’s on your mind, {user.name.split(" ")[0]}?</h2>
              <p>
                Let’s turn a tangled to-do list into a thoughtful plan.
                <br />
                Ask about your tasks, break down an idea, or find your next
                step.
              </p>
              <div className="suggestion-grid">
                {suggestions.map((suggestion, i) => (
                  <button
                    key={suggestion}
                    disabled={busy}
                    onClick={() => {
                      setInput(suggestion);
                    }}
                  >
                    <span>0{i + 1}</span>
                    {suggestion}
                    <ArrowUp size={16} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((item) => (
            <div key={item.id} className={`chat-message ${item.role}`}>
              <span
                className={`chat-avatar ${item.role === "assistant" ? "assistant-avatar" : ""}`}
              >
                {item.role === "assistant" ? (
                  <Sparkles size={18} />
                ) : (
                  <UserRound size={18} />
                )}
              </span>
              <div className="chat-content">
                <span className="chat-name">
                  {item.role === "assistant" ? "Kazi assistant" : "You"}
                </span>
                <p>{item.content}</p>
                {item.proposal && <ProposalCard proposal={item.proposal} />}
              </div>
            </div>
          ))}
          {busy && (
            <div className="chat-message assistant">
              <span className="chat-avatar assistant-avatar">
                <Sparkles size={18} />
              </span>
              <div className="chat-thinking" role="status">
                <LoaderCircle size={16} className="spin" />
                Taking a look at your workspace…
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
        <div className="assistant-composer">
          <ErrorBox>{error}</ErrorBox>
          <form onSubmit={submit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={4000}
              placeholder="A little clarity starts with a question…"
              aria-label="Message Kazi assistant"
              rows={2}
              disabled={busy}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <button
              className="send-button"
              type="submit"
              aria-label="Send message"
              disabled={busy || !input.trim()}
            >
              {busy ? (
                <LoaderCircle size={19} className="spin" />
              ) : (
                <ArrowUp size={21} />
              )}
            </button>
          </form>
          <p>
            <ShieldCheck size={13} />
            Suggestions are proposals. Nothing is saved without your
            confirmation.
          </p>
          <small>
            Requests share relevant workspace records with the server-configured
            AI provider. Chat is kept only in this view; follow-up requests
            should restate needed context.
          </small>
        </div>
      </section>
    </>
  );
}
