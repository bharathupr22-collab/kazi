"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { api, json, message } from "@/lib/api";
import { ErrorBox } from "@/components/ui/primitives";
type Mode = "login" | "register" | "forgot-password" | "reset-password";
const copy = {
  login: {
    title: "Good to have you back.",
    subtitle: "A clear mind starts with a clear workspace.",
    button: "Sign in to your workspace",
  },
  register: {
    title: "Make space for what matters.",
    subtitle: "Your next chapter of focused work starts here.",
    button: "Create your account",
  },
  "forgot-password": {
    title: "Let’s get you back in.",
    subtitle: "We’ll email you a secure link to reset your password.",
    button: "Send reset instructions",
  },
  "reset-password": {
    title: "A fresh start.",
    subtitle: "Choose a strong password for your workspace.",
    button: "Reset password",
  },
};
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [token, setToken] = useState("");
  useEffect(() => {
    if (mode === "reset-password")
      setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const body =
      mode === "register"
        ? { name: String(data.get("name") || "").trim(), email, password }
        : mode === "login"
          ? { email, password }
          : mode === "forgot-password"
            ? { email }
            : { token, password };
    try {
      const result = await api<{ message?: string }>(
        `/auth/${mode}`,
        json("POST", body),
      );
      if (mode === "login" || mode === "register") {
        router.replace("/dashboard");
        router.refresh();
      } else {
        setSuccess(result.message || "Request completed.");
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const info = copy[mode];
  return (
    <div className="auth-page">
      <aside className="auth-editorial">
        <Link href="/" className="brand">
          kazi<span>✳</span>
        </Link>
        <div className="auth-story">
          <span className="eyebrow">
            A LITTLE STRUCTURE. A LOT OF POSSIBILITY.
          </span>
          <h1>
            Less scattered.
            <br />
            More <em>in flow.</em>
          </h1>
          <p>
            Bring your tasks, ideas, and ambitions together.
            <br />
            Build a rhythm that feels like you.
          </p>
          <div className="auth-orbit" aria-hidden="true">
            <div className="orbit-ring" />
            <div className="orbit-center">✳</div>
            <span className="orbit-chip chip-one">
              <Check size={17} /> A clearer plan
            </span>
            <span className="orbit-chip chip-two">
              <Sparkles size={17} /> Room to think
            </span>
            <span className="orbit-chip chip-three">
              One meaningful step at a time
            </span>
          </div>
        </div>
        <span className="auth-footnote">
          YOUR WORK, WITH A LITTLE MORE INTENTION.
        </span>
      </aside>
      <main className="auth-main">
        <Link className="brand auth-mobile-brand" href="/">
          kazi<span>✳</span>
        </Link>
        <div className="auth-card">
          <span className="eyebrow">YOUR PERSONAL WORKSPACE</span>
          <h2>{info.title}</h2>
          <p>{info.subtitle}</p>
          {success ? (
            <div className="success-box" role="status">
              <Check size={22} />
              <p>{success}</p>
              <Link className="button primary" href="/login">
                Back to sign in <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="auth-form">
              <ErrorBox>{error}</ErrorBox>
              {mode === "register" && (
                <label>
                  Full name
                  <input
                    name="name"
                    autoComplete="name"
                    placeholder="Your name"
                    required
                    maxLength={100}
                  />
                </label>
              )}
              {mode !== "reset-password" && (
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    maxLength={254}
                  />
                </label>
              )}
              {mode !== "forgot-password" && (
                <label>
                  Password
                  <div className="password-field">
                    <input
                      name="password"
                      type={show ? "text" : "password"}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      placeholder={
                        mode === "login"
                          ? "Enter your password"
                          : "At least 10 characters"
                      }
                      required
                      minLength={mode === "login" ? 1 : 10}
                      maxLength={128}
                    />
                    <button
                      type="button"
                      aria-label={show ? "Hide password" : "Show password"}
                      className="icon-button"
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>
              )}
              {mode === "login" && (
                <Link href="/forgot-password" className="forgot-link">
                  Forgot password?
                </Link>
              )}
              {mode === "reset-password" && !token && (
                <ErrorBox>
                  This reset link is missing its token. Request a new password
                  reset email.
                </ErrorBox>
              )}
              <button
                className="button primary auth-submit"
                disabled={busy || (mode === "reset-password" && !token)}
                type="submit"
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <ArrowRight size={17} />
                )}{" "}
                {busy ? "Please wait…" : info.button}
              </button>
            </form>
          )}
          {!success && (
            <p className="auth-switch">
              {mode === "login" ? (
                <>
                  New to Kazi? <Link href="/register">Create an account</Link>
                </>
              ) : mode === "register" ? (
                <>
                  Already have an account? <Link href="/login">Sign in</Link>
                </>
              ) : (
                <Link href="/login">← Back to sign in</Link>
              )}
            </p>
          )}
          <div className="auth-security">
            <span /> Your workspace. Your data. Secure by design.
          </div>
        </div>
      </main>
    </div>
  );
}
