import { headers } from 'next/headers';
import { logger } from './observe/logger';

/**
 * TEMPORARY production diagnostic for the auth/entitlement regression.
 *
 * Answers one question: on a refresh of /api/auth/session, which branch of the
 * jwt callback retires the session — the unresolved-identity guard, the session
 * version guard, or a throw? Those three are indistinguishable from outside,
 * because Auth.js treats a `null` return and a thrown error the same way: it
 * deletes the session cookie and answers `null`
 * (`@auth/core/src/lib/actions/session.ts:82-89`).
 *
 * This module is observe-only. It must never influence authentication, so every
 * read is guarded and failures degrade to a sentinel rather than propagating.
 *
 * Field names avoid the substrings `token`/`jwt`/`secret`/`cookie` because
 * `sanitizeMeta` in ./observe/logger redacts any key containing them, which
 * would blank out exactly the values this diagnostic exists to capture.
 *
 * Nothing here records an identifier, an address, or a claim value — only
 * presence/absence booleans and which branch ran.
 *
 * REMOVE this file and its call sites in src/auth.ts once the failing branch is
 * identified.
 */

export type AuthJwtPhase = 'initial-login' | 'refresh';

export type AuthJwtRejection = 'missing_full_user' | 'session_version_mismatch' | 'other';

export interface AuthJwtDiagnostic {
  /** `initial-login` when Auth.js supplies `user` (sign-in), else a re-read. */
  phase: AuthJwtPhase;
  /** Whether the incoming token carries an `id` claim at all. */
  idClaimPresent: boolean;
  /** Whether the incoming token carries an `email` claim at all. */
  emailClaimPresent: boolean;
  /** null = the email-gated block never ran, so the lookup was never attempted. */
  fullUserFound: boolean | null;
  versionClaimPresent: boolean | null;
  dbVersionPresent: boolean | null;
  /** Strict equality of the two versions; null when the token carried none. */
  versionMatches: boolean | null;
  rejection: AuthJwtRejection | null;
}

export function newAuthJwtDiagnostic(user: unknown): AuthJwtDiagnostic {
  return {
    phase: user ? 'initial-login' : 'refresh',
    idClaimPresent: false,
    emailClaimPresent: false,
    fullUserFound: null,
    versionClaimPresent: null,
    dbVersionPresent: null,
    versionMatches: null,
    rejection: null,
  };
}

/**
 * Opaque platform correlation id for the invocation being logged, so the entry
 * can be tied to the exact request that produced it. `x-vercel-id` is injected
 * by the platform per invocation; `x-request-id` is the app's own id when a
 * client or proxy supplied one. Both are infrastructure identifiers and carry
 * no user data.
 */
async function readCorrelationId(): Promise<string> {
  try {
    const requestHeaders = await headers();
    return requestHeaders.get('x-vercel-id') || requestHeaders.get('x-request-id') || 'unavailable';
  } catch {
    // No request scope (or headers unavailable) — the entry is still worth having.
    return 'unavailable';
  }
}

export async function emitAuthJwtDiagnostic(diag: AuthJwtDiagnostic): Promise<void> {
  try {
    logger.info('auth.jwt.callback', { correlationId: await readCorrelationId(), ...diag });
  } catch {
    // Diagnostics must never break sign-in.
  }
}