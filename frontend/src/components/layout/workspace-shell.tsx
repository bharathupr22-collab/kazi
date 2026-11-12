"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Columns3,
  FolderOpen,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Settings2,
  Sparkles,
  StickyNote,
  Sun,
  X,
} from "lucide-react";
import { useWorkspace } from "@/providers/workspace-provider";
import { useUI } from "@/providers/ui-provider";
import { api, json, message } from "@/lib/api";
import { formatDate } from "@/lib/dates";
import { Modal } from "@/components/ui/primitives";
const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/tasks", label: "My tasks", icon: ListTodo },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/kanban", label: "Kanban board", icon: Columns3 },
  { href: "/assistant", label: "Kazi assistant", icon: Sparkles },
  { href: "/notes", label: "Notes & ideas", icon: StickyNote },
  { href: "/analytics", label: "Insights", icon: BarChart3 },
];
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, tasks, notifications, mutate, refresh, refreshing, errors } =
    useWorkspace();
  const { theme, setTheme, toast } = useUI();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const unread = notifications.filter((n) => !n.read).length;
  async function logout() {
    setLoggingOut(true);
    try {
      await api("/auth/logout", json("POST"));
      router.replace("/login");
      router.refresh();
    } catch (error) {
      toast(message(error));
      setLoggingOut(false);
    }
  }
  async function mark(id: string, read: boolean) {
    setReading(id);
    try {
      await mutate(`/notifications/${id}`, "PATCH", { read });
    } catch (error) {
      toast(message(error));
    } finally {
      setReading(null);
    }
  }
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {open && (
        <button
          aria-label="Close navigation"
          className="sidebar-overlay"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <Link className="brand" href="/dashboard" aria-label="Kazi home">
            kazi<span>✳</span>
          </Link>
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-monogram">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>Personal workspace</strong>
            <span>Your space to make progress</span>
          </div>
        </div>
        <p className="nav-heading">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`nav-link ${pathname === href ? "active" : ""}`}
              aria-current={pathname === href ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {href === "/tasks" &&
                tasks.filter((t) => t.status !== "completed").length > 0 && (
                  <b className="nav-count">
                    {tasks.filter((t) => t.status !== "completed").length}
                  </b>
                )}
              {href === "/assistant" && <span className="ai-tag">AI</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/assistant" className="assistant-promo">
            <span className="promo-icon">
              <Sparkles size={19} />
            </span>
            <strong>A little clarity goes a long way.</strong>
            <span>
              Make a plan with Kazi <ArrowUpRight size={14} />
            </span>
          </Link>
          <Link
            className={`nav-link ${pathname === "/settings" ? "active" : ""}`}
            href="/settings"
            onClick={() => setOpen(false)}
          >
            <Settings2 size={19} />
            Settings
          </Link>
          <div className="sidebar-user">
            <Link href="/settings" className="user-profile">
              <span className="avatar">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <div>
                <strong>{user.name}</strong>
                <span>Personal account</span>
              </div>
            </Link>
            <button
              className="icon-button"
              disabled={loggingOut}
              title="Sign out"
              aria-label="Sign out"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span className="muted">Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {navigation.find((n) => n.href === pathname)?.label || "Settings"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="today-label">
              {new Intl.DateTimeFormat("en", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: user.timezone,
              }).format(new Date())}
            </span>
            <button
              className="icon-button"
              disabled={refreshing}
              onClick={refresh}
              aria-label="Refresh workspace"
              title="Refresh workspace"
            >
              <RefreshCw size={17} className={refreshing ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button
              className="icon-button notification-toggle"
              aria-label={`Notifications, ${unread} unread`}
              onClick={() => setPanel(true)}
            >
              <Bell size={19} />
              {unread > 0 && <span className="notification-dot" />}
            </button>
            <Link
              className="avatar avatar-small"
              href="/settings"
              aria-label="Account settings"
            >
              {user.name.charAt(0).toUpperCase()}
            </Link>
          </div>
        </header>
        <main id="main" className="main-content">
          {errors.length > 0 && (
            <div className="data-error" role="alert">
              <div>
                <strong>Some workspace data could not be refreshed.</strong>
                {errors.map((e) => (
                  <p key={e}>{e}</p>
                ))}
              </div>
              <button
                className="button"
                onClick={refresh}
                disabled={refreshing}
              >
                Retry
              </button>
            </div>
          )}
          {children}
          <footer className="page-footer">
            <span>Less noise. More meaningful work.</span>
            <span>
              Made for your momentum <span className="teal">✳</span>
            </span>
          </footer>
        </main>
      </div>
      {panel && (
        <Modal title="Your notifications" onClose={() => setPanel(false)}>
          <div className="modal-body notification-list">
            {notifications.length === 0 ? (
              <div className="empty">
                <Bell size={28} />
                <h3>You’re all caught up.</h3>
                <p>Task reminders and overdue notices will appear here.</p>
              </div>
            ) : (
              notifications.map((n) => (
                <article
                  className={`notification-item ${!n.read ? "unread" : ""}`}
                  key={n.id}
                >
                  <span className="notification-item-icon">
                    <Bell size={18} />
                  </span>
                  <div>
                    <strong>{n.title}</strong>
                    <p>{n.message}</p>
                    <small>
                      {formatDate(n.created_at, user.timezone, true)}
                    </small>
                    <button
                      className="text-button"
                      disabled={reading === n.id}
                      onClick={() => mark(n.id, !n.read)}
                    >
                      <Check size={13} />
                      {n.read ? "Mark unread" : "Mark as read"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
