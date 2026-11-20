import { after, NextRequest, NextResponse } from 'next/server';
import { getPaddleClient } from '@/lib/billing/paddle';
import { receiveBillingEvent } from '@/lib/billing/operations';
import { readBoundedBody } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
// `after()` keeps this invocation alive until the triggered worker responds, so
// the budget must cover the worker's own 45 s drain. Not used by the webhook
// response itself, which is sent before the trigger starts.
export const maxDuration = 60;

const MAX_WEBHOOK_BODY_BYTES = 1_048_576;
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

async function triggerBillingWorker(): Promise<void> {
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

export async function POST(request: NextRequest) {
  const raw = await readBoundedBody(request, MAX_WEBHOOK_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'Webhook payload is too large' }, { status: 413 });
  }
  const signature = request.headers.get('paddle-signature') || '';
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  const paddle = getPaddleClient();
  if (!secret || !paddle) {
    return NextResponse.json({ error: 'Paddle webhook is not configured' }, { status: 503 });
  }

  let event;
  try {
    event = await paddle.webhooks.unmarshal(raw, secret, signature);
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  if (!event.eventId || !event.eventType) {
    return NextResponse.json({ error: 'Invalid webhook event' }, { status: 400 });
  }
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: 'Invalid webhook event timestamp' }, { status: 400 });
  }
  try {
    const receipt = await receiveBillingEvent({
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event,
      occurredAt,
    });
    after(triggerBillingWorker);
    return NextResponse.json(
      { status: 'accepted', duplicate: receipt.duplicate },
      { status: receipt.duplicate ? 200 : 202, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    console.error('Paddle webhook could not be durably recorded');
    return NextResponse.json({ error: 'Webhook could not be durably recorded' }, { status: 503 });
  }
}
