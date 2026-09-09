import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { rateLimit } from '@/lib/rate-limit';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const FEEDBACK_RATE_LIMIT_MAX = 3;
const FEEDBACK_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function sanitizeFeedback(text: string): string {
  return text
    .replace(/@everyone/gi, '@\u200Beveryone')
    .replace(/@here/gi, '@\u200Bhere')
    .replace(/<@/g, '<\u200B@')
    .replace(/[<>"'`]/g, '')
    .trim()
    .slice(0, 500);
}

export async function POST(request: NextRequest) {
  try {
    if (!DISCORD_WEBHOOK_URL) {
      return NextResponse.json({ error: 'Feedback not configured' }, { status: 503 });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = rateLimit(`feedback:${session.user.id}`, FEEDBACK_RATE_LIMIT_MAX, FEEDBACK_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many feedback submissions. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const body = await request.json();
    const { text } = body as { text?: string };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: 'Feedback text required' }, { status: 400 });
    }

    const sanitized = sanitizeFeedback(text);
    if (sanitized.length === 0) {
      return NextResponse.json({ error: 'Invalid feedback text' }, { status: 400 });
    }

    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**SupersmartX Studio Feedback** (user: ${session.user.id.slice(0, 8)})\n${sanitized}`,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to send feedback');
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Discord feedback error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to send feedback' }, { status: 500 });
  }
}
