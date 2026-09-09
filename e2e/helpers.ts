import { Page } from '@playwright/test';

export async function dismissWelcomeModal(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  const welcomeDialog = page.getByRole('dialog', { name: /welcome/i });
  if (await welcomeDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
    const dismissButton = page.getByRole('button', { name: /get started|explore|close|dismiss|skip/i }).first();
    if (await dismissButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dismissButton.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await welcomeDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

export async function dismissAllModals(page: Page) {
  const dialogs = page.getByRole('dialog');
  const count = await dialogs.count();
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}
