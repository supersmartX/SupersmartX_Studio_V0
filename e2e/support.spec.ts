import { test, expect } from '@playwright/test';

// The success page is server-verified: "Payment Successful" is only rendered
// when Cashfree's authoritative state says PAID for the signed-in account. With
// no session and no reachable gateway, the page MUST fall back to the neutral
// confirming state. These specs lock that in — an earlier version of this file
// asserted the opposite (a success heading from URL parameters alone), which is
// exactly the vulnerability the server-side verification was added to close.
test.describe('Support - Success Page is server-verified', () => {
  test('does not claim success from query parameters alone', async ({ page }) => {
    await page.goto('/support/success?order_id=order-123&plan=creator_monthly');

    await expect(page.getByRole('heading', { name: /confirming your payment/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /payment successful/i })).toHaveCount(0);
    await expect(page.getByText(/thank you for subscribing/i)).toHaveCount(0);
  });

  test('shows an awaiting-confirmation status rather than Paid', async ({ page }) => {
    await page.goto('/support/success?order_id=order-456&plan=creator_monthly');

    await expect(page.getByText('Awaiting confirmation')).toBeVisible();
    await expect(page.getByText('Paid', { exact: true })).toHaveCount(0);
  });

  test('never asserts that a confirmation email was sent without verification', async ({ page }) => {
    await page.goto('/support/success?order_id=order-456&plan=creator_monthly');

    await expect(page.getByText(/confirmation email sent/i)).toHaveCount(0);
  });

  test('echoes the order reference back for support traceability', async ({ page }) => {
    await page.goto('/support/success?order_id=order-456&plan=creator_monthly');

    await expect(page.getByText('order-456')).toBeVisible();
  });

  test('has link back to studio', async ({ page }) => {
    await page.goto('/support/success?order_id=order-123&plan=creator_monthly');
    const studioLink = page.getByRole('link', { name: /studio/i }).first();
    const hasLink = await studioLink.isVisible().catch(() => false);
    if (hasLink) {
      await studioLink.click();
      await expect(page).toHaveURL(/\/studio/);
    }
  });
});

test.describe('Support - Error Handling', () => {
  test('handles missing order_id gracefully', async ({ page }) => {
    await page.goto('/support/success');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /payment successful/i })).toHaveCount(0);
  });

  test('handles invalid order_id', async ({ page }) => {
    await page.goto('/support/success?order_id=invalid-order&plan=creator_monthly');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /payment successful/i })).toHaveCount(0);
  });

  test('a forged paid-looking plan parameter does not grant or claim a plan', async ({ page }) => {
    // A legacy/pro id in the URL must not surface as an activated plan.
    await page.goto('/support/success?order_id=forged&plan=pro_yearly');
    await expect(page.getByRole('heading', { name: /confirming your payment/i })).toBeVisible();
  });
});

test.describe('Legal Pages', () => {
  test('terms page loads with content', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  });

  test('privacy page loads with content', async ({ page }) => {
    await page.goto('/legal/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  });

  test('legal pages are accessible from landing page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const termsLink = page.getByRole('link', { name: /terms/i }).first();
    const privacyLink = page.getByRole('link', { name: /privacy/i }).first();

    const hasTerms = await termsLink.isVisible().catch(() => false);
    const hasPrivacy = await privacyLink.isVisible().catch(() => false);

    if (hasTerms) {
      await termsLink.click();
      await expect(page).toHaveURL(/\/legal\/terms/);
    }

    if (hasPrivacy) {
      await page.goto('/');
      await privacyLink.click();
      await expect(page).toHaveURL(/\/legal\/privacy/);
    }
  });
});
