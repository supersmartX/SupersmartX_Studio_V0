/**
 * Session-version reconciliation.
 *
 * Every session JWT carries the `session_version` of the user row it was minted
 * from, and the row's version is bumped whenever an existing token must stop
 * working (password reset) or the identity itself ends (account deletion).
 * A token whose version no longer matches the row is refused.
 *
 * The one exception is a token minted before the claim existed: it carries no
 * version at all. Such a token adopts the current row version once instead of
 * being rejected, because rejecting it would also reject the very first sign-in
 * of a brand-new user (the row version is 0 and the token has none). After that
 * single adoption the comparison is strict.
 *
 * Kept in its own module so the rule is testable without standing up NextAuth.
 */
export function reconcileSessionVersion(
  tokenVersion: unknown,
  userVersion: number,
): number | null {
  if (tokenVersion === undefined || tokenVersion === null) {
    return userVersion;
  }
  return tokenVersion === userVersion ? userVersion : null;
}