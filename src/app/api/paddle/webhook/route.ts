import { after, NextRequest, NextResponse } from 'next/server';
import { getPaddleClient } from '@/lib/billing/paddle';
import { receiveBillingEvent } from '@/lib/billing/operations';
import { triggerBillingWorker } from '@/lib/billing/worker-trigger';
import { readBoundedBody } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
// `after()` keeps this invocation alive until the triggered worker responds, so
// the budget must cover the worker's own 45 s drain. Not used by the webhook
// response itself, which is sent before the trigger starts.
export const maxDuration = 60;

const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

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
