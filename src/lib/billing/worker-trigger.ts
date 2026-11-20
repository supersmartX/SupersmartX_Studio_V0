const WORKER_TRIGGER_TIMEOUT_MS = 50_000;
const WORKER_TRIGGER_RETRY_DELAY_MS = 250;

function webhookWorkerBaseUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
    || process.env.NEXTAUTH_URL?.trim()
    || (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : '');
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Starts a worker drain from inside a request. Fire it through `after()` so the
 * invocation stays alive for the worker's own budget; callers that only enqueue
 * a durable event stay correct even when this cannot run.
 */
export async function triggerBillingWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET?.trim();
  const baseUrl = webhookWorkerBaseUrl();
  if (!secret || !baseUrl) return;
  const deadline = Date.now() + WORKER_TRIGGER_TIMEOUT_MS;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining < 1_000) break;
    try {
      const response = await fetch(`${baseUrl}/api/internal/paddle/worker`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${secret}`,
          'cache-control': 'no-store',
        },
        signal: AbortSignal.timeout(remaining),
        cache: 'no-store',
      });
      if (!response.ok) {
        console.error('Paddle worker trigger returned a non-success status', response.status);
      }
      return;
    } catch {
      // A connection-level failure is worth one retry; a timeout is not, because
      // the worker it started may still be running and owns the event leases.
      if (attempt === 1 || remaining < 5_000) {
        console.error('Paddle worker could not be triggered after webhook receipt');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, WORKER_TRIGGER_RETRY_DELAY_MS));
    }
  }
}
