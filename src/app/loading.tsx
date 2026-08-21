export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-canvas">
      <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-text-secondary">Loading...</span>
      </div>
    </div>
  );
}
