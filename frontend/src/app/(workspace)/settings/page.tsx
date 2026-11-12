"use client";
import { useState, type FormEvent } from "react";
import {
  Bell,
  Check,
  Globe2,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import type { User } from "@/types";
import { message } from "@/lib/api";
import { ErrorBox, PageHeading, SaveButton } from "@/components/ui/primitives";
export default function SettingsPage() {
  const { user, setUser, mutate } = useWorkspace();
  const { theme, setTheme, toast } = useUI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const zones = Array.from(
    new Set([
      user.timezone,
      "UTC",
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const updated = await mutate<User>("/auth/me", "PATCH", {
        name: String(data.get("name")).trim(),
        timezone: String(data.get("timezone")),
        notifications_enabled: data.get("notifications_enabled") === "on",
      });
      setUser(updated);
      toast("Your workspace, your way. Settings saved.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE YOURSELF AT HOME"
        title="Your workspace, your way"
        description="A few thoughtful preferences for a better everyday rhythm."
      />
      <div className="settings-layout">
        <aside className="settings-intro">
          <span className="avatar settings-avatar">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <span className="badge neutral">Personal workspace</span>
          <div className="settings-security">
            <ShieldCheck size={20} />
            <strong>A secure little corner.</strong>
            <p>
              Your session uses a protected HttpOnly cookie. Your credentials
              never live in browser storage.
            </p>
          </div>
        </aside>
        <div className="settings-sections">
          <form className="panel" onSubmit={save}>
            <div className="panel-header">
              <div>
                <h2>
                  <UserRound size={18} />
                  Profile & preferences
                </h2>
                <p>The details that make this space yours.</p>
              </div>
            </div>
            <div className="settings-form form-stack">
              <ErrorBox>{error}</ErrorBox>
              <label>
                Your name
                <input
                  name="name"
                  defaultValue={user.name}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Email address
                <input type="email" value={user.email} disabled readOnly />
                <span className="field-hint">
                  Your sign-in email is managed by your account.
                </span>
              </label>
              <label>
                <span className="label-icon">
                  <Globe2 size={15} />
                  Timezone
                </span>
                <select name="timezone" defaultValue={user.timezone}>
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Used for reporting, due-today filters, and workspace dates.
                  Calendar editing uses your device timezone and labels it
                  explicitly.
                </span>
              </label>
              <div className="notification-preference">
                <div>
                  <strong>
                    <Bell size={17} />
                    Task notifications
                  </strong>
                  <p>
                    Show due reminders and overdue tasks in your notification
                    panel.
                  </p>
                </div>
                <label className="switch">
                  <input
                    aria-label="Enable task notifications"
                    type="checkbox"
                    name="notifications_enabled"
                    defaultChecked={user.notifications_enabled}
                  />
                  <span />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <SaveButton busy={busy} />
            </div>
          </form>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>
                  <Monitor size={18} />
                  Look & feel
                </h2>
                <p>A little easier on the eyes.</p>
              </div>
            </div>
            <div className="appearance-options">
              {[
                { value: "light", label: "Light & clear", icon: Sun },
                { value: "dark", label: "After hours", icon: Moon },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  className={`theme-option ${theme === value ? "selected" : ""}`}
                  onClick={() => setTheme(value)}
                  aria-pressed={theme === value}
                >
                  <div className={`theme-preview ${value}`}>
                    <div />
                    <span />
                    <span />
                    <span />
                  </div>
                  <strong>
                    <Icon size={16} />
                    {label}
                    {theme === value && <Check size={16} />}
                  </strong>
                </button>
              ))}
            </div>
            <p className="appearance-note">
              Appearance is saved on this device only.
            </p>
          </section>
          <section className="panel account-security">
            <ShieldCheck size={22} />
            <div>
              <h3>Keep your account secure</h3>
              <p>Need a new password? We’ll send a reset link to your email.</p>
              <Link className="text-button" href="/forgot-password">
                Request a password reset →
              </Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
