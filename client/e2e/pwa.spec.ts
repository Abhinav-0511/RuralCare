import { expect, test } from '@playwright/test';
import { login, PHONES, waitUntilOfflineReady } from './helpers';

// Lighthouse 12+ dropped its PWA category, so installability is checked with Chrome itself.
test('Chrome reports the app as installable (manifest, icons, service worker)', async ({ page, context }) => {
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  const { url } = await cdp.send('Page.getAppManifest');
  expect(url).toMatch(/manifest\.webmanifest$/);
});

test('after one online visit the whole app opens with no network at all', async ({ page, context }) => {
  await login(page, PHONES.hwKelambakkam);
  await waitUntilOfflineReady(page);
  await context.setOffline(true);
  for (const path of ['/triage', '/history', '/hw']) {
    await page.goto(path);
    await expect(page.getByTestId('online-status')).toHaveAttribute('data-online', 'false');
  }
  await page.goto('/triage');
  await expect(page.getByTestId('wizard-step-patient')).toBeVisible();
  await expect(page.getByTestId('patient-option').first()).toBeVisible(); // patients cached in IndexedDB
  await context.setOffline(false);
});
