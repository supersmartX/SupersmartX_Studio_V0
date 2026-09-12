import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { consumeResetToken } from '@/lib/db';
import { updateUserPassword } from '@/lib/user-store';
import { rateLimit } from '@/lib/rate-limit';
import { validatePassword } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 requests per minute per IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed, retryAfterMs } = rateLimit(`reset:${ip}`, 5, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
      );
    }

    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: 'Token and password are required' }, { status: 400 });
    }

    const validation = validatePassword(password);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    // Atomic single-use token consume (prevents replay)
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = await consumeResetToken(tokenHash);

    if (!record) {
      return NextResponse.json({ error: 'Invalid or expired reset token' }, { status: 400 });
    }

    // Pass raw password — updateUserPassword handles hashing
    const updated = await updateUserPassword(record.email, password);
    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
