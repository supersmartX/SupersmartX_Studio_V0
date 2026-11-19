import { NextRequest, NextResponse } from 'next/server';
import { getPaddleClient } from '@/lib/billing/paddle';
import { receiveBillingEvent } from '@/lib/billing/operations';

export const dynamic = 'force-dynamic';

const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: NextRequest) {
  const raw = await readBoundedBody(request);
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
    return NextResponse.json(
      { status: 'accepted', duplicate: receipt.duplicate },
      { status: receipt.duplicate ? 200 : 202, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    console.error('Paddle webhook could not be durably recorded');
    return NextResponse.json({ error: 'Webhook could not be durably recorded' }, { status: 503 });
  }
}
