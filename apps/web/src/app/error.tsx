'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="container narrow portal">
      <h1>Something went wrong</h1>
      <p>
        Please try again. If it keeps happening, contact the property office. No payment is affected
        by this error.
      </p>
      <button type="button" className="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
