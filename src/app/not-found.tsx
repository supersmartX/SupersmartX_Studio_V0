import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas text-white p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="text-7xl font-semibold tracking-tight">404</div>
        <h1 className="text-xl font-medium">Page not found</h1>
        <p className="text-white/40 text-sm leading-relaxed">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center h-11 px-6 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 transition-all"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
