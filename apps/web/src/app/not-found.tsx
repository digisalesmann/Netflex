import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="container narrow portal">
      <h1>Page not found</h1>
      <p>That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <p>
        <Link className="button" href="/">
          Go to the home page
        </Link>
      </p>
    </main>
  );
}
