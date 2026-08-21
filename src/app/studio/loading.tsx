export default function StudioLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-text-secondary">Loading studio...</span>
      </div>
    </div>
  );
}
