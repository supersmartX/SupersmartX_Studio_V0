## Fix Analysis for Three Authentication/Navigation Issues

### Issue 1: User must click "Back to all options" before logging in

**Root Cause**: The AuthModal defaults to the 'chooser' step (account selection) when `intent` is not explicitly 'login'. When a user clicks "Log in", the intent should be 'login' to open directly on the email sign-in step. However, the test helper `openAuthFromLanding` unconditionally clicks "Back to all options" after opening the modal, reinforcing the old behavior.

**Code Flow**:
- `AuthModal.tsx` line 39: `const initialStep: 'chooser' | 'email' = intent === 'login' ? 'email' : 'chooser';`
- When `intent='login'`, modal opens on 'email' step
- When `intent='register'` (default), modal opens on 'chooser' step
- The "Back to all options" button (line 411-418) sets step back to 'chooser'

**Fix**: Ensure `intent='login'` is properly passed when user clicks "Log in" from any entry point (landing page, studio header, mobile nav). The production code already does this for the main entry points, but the test helper `openAuthFromLanding` perpetuates the old behavior by always clicking "Back to all options".

### Issue 2: After signing in, complete-payment page opens automatically

**Root Cause**: In `studio/page.tsx`, the effect at lines 266-274 opens the pricing modal after session becomes authenticated if `checkoutIntent` is set. The `checkoutIntent` is captured from `?checkout=creator_monthly|creator_yearly` URL param or localStorage `sxs-pending-plan`. This means after any sign-in, if there was a previous checkout intent captured, the pricing modal opens automatically - even for ordinary sign-ins without a genuine pending payment.

**Code Flow**:
- Lines 229-263: Capture `?checkout` param or localStorage `sxs-pending-plan` into `checkoutIntent`
- Lines 266-274: When session becomes authenticated, open pricing modal if `checkoutIntent` is set
- `handleAuthSuccessWithPricing` (lines 209-222): Also opens pricing modal if `pendingPricingAfterAuth` or `checkoutIntent` is set

**Fix**: The effect at lines 266-274 should only open the pricing modal after sign-in if there's a genuine pending payment (indicated by `pendingPricingAfterAuth`), not just because `checkoutIntent` was captured from a previous "Start Creator" click. The `checkoutIntent` should clear after sign-in unless it came from a genuine payment return (`?payment=success` param).

### Issue 3: Clicking main logo causes user to log in again

**Root Cause**: When navigating between the marketing website and Studio (via the logo link `href="/"`), the NextAuth session should persist because the cookie has `path: '/'`. However, there may be a session-fetch failure or an unnecessary login redirect caused by:
- Cookie scope issues across subdomains
- Session not being properly fetched during navigation
- The `SessionProvider` not preserving the session across page transitions

**Code Flow**:
- Landing page logo: `<Link href="/">` (page.tsx line 819)
- Studio header logo: `<Link href="/">` (Header.tsx line 53)
- Both should preserve the NextAuth session since cookie has `path: '/'`
- Middleware only protects `/api/:path*`, not `/`

**Fix**: Ensure the NextAuth session cookie is properly shared across the domain. The cookie config already has `path: '/'` and `sameSite: 'lax'`, which should work for same-domain navigation. The fix may involve ensuring the session is properly fetched/retained on page load, or addressing any cookie scope issues.

## Implementation Plan

1. **Fix 1**: Update AuthModal to ensure `intent='login'` opens on email step; update test helper expectations
2. **Fix 2**: Modify studio/page.tsx effect to not open pricing modal after ordinary sign-in; only open if `pendingPricingAfterAuth` is set
3. **Fix 3**: Verify/fix session cookie configuration and ensure session persistence on logo navigation

Let me implement these fixes now.