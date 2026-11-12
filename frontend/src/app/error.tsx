"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="boot-error">
      <h1>Something interrupted your flow.</h1>
      <p>
        Your saved work is still on the server. Try loading this view again.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
