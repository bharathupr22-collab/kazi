import Link from "next/link";
export default function NotFound() {
  return (
    <main className="boot-error">
      <span className="eyebrow">404 / A little off track</span>
      <h1>Let’s find your way back.</h1>
      <p>This page isn’t part of your workspace.</p>
      <Link className="button primary" href="/dashboard">
        Go to dashboard
      </Link>
    </main>
  );
}
