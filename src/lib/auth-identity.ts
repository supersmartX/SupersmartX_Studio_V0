import { findUserByEmail, findUserById } from './db';
import type { StoredUser } from '@/types/db';

/**
 * Resolve the authoritative user row for a session identity.
 *
 * A session's `user.id` can diverge from the stored row id (e.g. an OAuth
 * subject recorded at sign-in while the durable row was created under a
 * different id during registration or payment). Plan display resolves by
 * email, but every export/download endpoint resolves by id — a diverged
 * session therefore looks like a Creator in the UI while every server call
 * fails with "User not found".
 *
 * Resolution order:
 * 1. Row by session id (healthy path — no behavior change).
 * 2. Row by session email (heals a diverged session by adopting the DB id).
 * 3. `null` when neither exists (orphaned identity — caller invalidates).
 *
 * DB errors propagate (same as today); only "not found" falls through.
 */
export async function resolveSessionUser(
  tokenId: string | undefined | null,
  email: string | undefined | null,
): Promise<StoredUser | null> {
  if (tokenId) {
    const byId = await findUserById(tokenId);
    if (byId) return byId;
  }
  if (email) {
    const byEmail = await findUserByEmail(email);
    if (byEmail) return byEmail;
  }
  return null;
}
