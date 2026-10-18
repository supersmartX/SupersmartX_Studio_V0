import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findUserById, listUserExportR2Keys, purgeUserOwnedData, deleteUserById, recordDeletedIdentity } from '@/lib/db';
import { listUserRecordings, deleteRecording } from '@/lib/r2';
import { rateLimit } from '@/lib/rate-limit';

// Phase 2.9: account deletion is the most destructive account-sensitive
// mutation, so it carries an explicit per-user boundary regardless of session
// validity (the password gate lives in the client flow, not this route).
const DELETE_RATE_LIMIT_MAX = 5;
const DELETE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Both cookie names must be cleared: NextAuth issues the `__Secure-` prefixed
// cookie in production and the bare name everywhere else.
function clearSessionCookies(response: NextResponse): NextResponse {
  for (const name of ['__Secure-next-auth.session-token', 'next-auth.session-token']) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return response;
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = rateLimit(`user-delete:${session.user.id}`, DELETE_RATE_LIMIT_MAX, DELETE_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });

    // 1. Identify all R2 objects owned by user (exports prefix)
    let r2Keys: string[] = [];
    try {
      // Get keys from DB first (authoritative)
      const keys = await listUserExportR2Keys(session.user.id);
      r2Keys = keys.filter((k) => k && !k.startsWith('local/'));
      // Also list via R2 prefix to catch any orphan jobs without DB row
      try {
        const listed = await listUserRecordings(`exports/${session.user.id}/`);
        for (const obj of listed) {
          if (!r2Keys.includes(obj.key)) r2Keys.push(obj.key);
        }
      } catch {}
    } catch (e) {
      console.warn('Failed to list R2 keys for deletion', e);
    }

    // 2. Delete R2 objects safely (idempotent)
    for (const key of r2Keys) {
      try {
        await deleteRecording(key);
      } catch (e: any) {
        const msg = e?.message || '';
        const isMissing = msg.includes('NotFound') || msg.includes('NoSuchKey');
        if (!isMissing) console.warn(`Failed to delete R2 object ${key}`, e);
        // Continue — treat missing as success
      }
    }

    // 3. Delete DB records (the final users delete cascades anything left)
    // Do this after R2 deletion to avoid losing references
    await purgeUserOwnedData(session.user.id);

    // Retire every token ever issued for this identity BEFORE the row goes
    // away. The tombstone is keyed by email and carries the next session
    // version, so a later signup on this address starts above it — otherwise
    // resolveSessionUser's email fallback would hand the deleted account's
    // still-signed cookie to the new identity.
    try {
      await recordDeletedIdentity(user.email, user.sessionVersion + 1);
    } catch (e) {
      // Fail closed: an unrecorded deletion leaves the old session usable, so
      // the account row is kept rather than silently re-provisioned later.
      console.error('Failed to record deleted identity tombstone', e);
      return NextResponse.json({ error: 'Deletion failed' }, { status: 500 });
    }

    const userDeleted = await deleteUserById(session.user.id);

    const response = NextResponse.json({ success: true, deletedR2Objects: r2Keys.length, userDeleted });
    return clearSessionCookies(response);
  } catch (e) {
    console.error('Account deletion failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Deletion failed' }, { status: 500 });
  }
}
