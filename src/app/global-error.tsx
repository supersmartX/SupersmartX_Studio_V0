'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: '#09090B', color: '#FAFAFA', fontFamily: 'system-ui, sans-serif' }}>
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">Something went wrong</h1>
              {/* Never render `error.message` here. This boundary sits above the
                  app, so the message is whatever the renderer threw — a Prisma
                  string, a module-resolution trace, a null deref — which is both
                  meaningless to the person reading it and a leak of internals.
                  The digest is an opaque hash, safe to show, and is what support
                  needs to match this failure to a server log. */}
              <p className="text-sm text-gray-400">
                An unexpected error occurred. Your work has not been saved —
                try again, and if it keeps happening, contact support with the
                code below.
              </p>
              {error.digest && (
                <p className="text-xs text-gray-500 font-mono">Support code: {error.digest}</p>
              )}
            </div>
            <button
              onClick={reset}
              className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
