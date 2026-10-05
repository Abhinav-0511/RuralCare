import { expect, test } from '@playwright/test';
import { apiAs, deviceFor, injectVitals, login, PHONES, runTriage, waitUntilOfflineReady } from './helpers';

test.describe('online triage', () => {
  test('health worker: online model result with conditions, advice and disclaimer', async ({ page }) => {
    await login(page, PHONES.hwKelambakkam);
    await runTriage(page, {
      patientName: 'Senthil Kumar',
      areas: ['chest'],
      symptoms: ['runny_nose', 'congestion', 'cough'],
    });
    await expect(page.getByTestId('result-source')).toHaveAttribute('data-source', 'online_model');
    await expect(page.getByTestId('possible-conditions')).toContainText('Common cold');
    await expect(page.getByTestId('disclaimer')).toContainText('not a medical diagnosis');
    await expect(page.getByTestId('call-108')).toHaveCount(0);
  });

  test('danger sign: EMERGENCY with a big "Call 108" button', async ({ page }) => {
    await login(page, PHONES.hwKelambakkam);
    await runTriage(page, { patientName: 'Senthil Kumar', symptoms: ['chest_pain'] });
    await expect(page.getByTestId('result-level')).toHaveAttribute('data-level', 'EMERGENCY');
    await expect(page.getByTestId('call-108')).toHaveAttribute('href', 'tel:108');
    await expect(page.getByTestId('result-source')).toHaveAttribute('data-source', 'rules');
  });

  test('severe symptoms raise the level (safety floor)', async ({ page }) => {
    await login(page, PHONES.hwKelambakkam);
    await runTriage(page, {
      patientName: 'Senthil Kumar',
      symptoms: ['runny_nose', 'congestion', 'cough'],
      severity: 'severe',
    });
    await expect(page.getByTestId('result-level')).toHaveAttribute('data-level', 'SEE_DOCTOR_24H');
  });
});

test.describe('offline', () => {
  test('goes offline, triages on the device, comes back online and syncs', async ({ page, context }) => {
    await login(page, PHONES.hwKelambakkam);
    await waitUntilOfflineReady(page);

    await context.setOffline(true);
    await page.reload(); // the app shell comes from the service worker
    await expect(page.getByTestId('online-status')).toHaveAttribute('data-online', 'false');

    await runTriage(page, {
      patientName: 'Senthil Kumar',
      symptoms: ['runny_nose', 'congestion', 'sinus_pressure', 'cough'],
    });
    await expect(page.getByTestId('result-source')).toHaveAttribute('data-source', 'offline_model');
    await expect(page.getByTestId('pending-note')).toBeVisible();
    await expect(page.getByTestId('pending-count')).toHaveAttribute('data-count', '1');
    const clientId = page.url().split('/result/')[1]!;

    await context.setOffline(false);
    await expect(page.getByTestId('online-status')).toHaveAttribute('data-online', 'true', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('pending-count')).toHaveAttribute('data-count', '0', { timeout: 30_000 });

    // The server now has the session, recorded as an offline sync.
    const api = await apiAs(PHONES.hwKelambakkam);
    const list = await api.get('/api/triage?limit=50');
    const synced = list.items.find((s: { clientId: string }) => s.clientId === clientId);
    expect(synced).toMatchObject({ origin: 'offline_sync', patientName: 'Senthil Kumar' });
  });

  test("shows a clear message when the server's result differs after sync", async ({ page, context }) => {
    await login(page, PHONES.hwKelambakkam);
    await waitUntilOfflineReady(page);
    // A critical SpO2 from Lakshmi's home device: the phone doesn't know, the server does.
    injectVitals(deviceFor('Lakshmi Murugan').deviceId, 'spo2_critical');

    await context.setOffline(true);
    await page.reload();
    await runTriage(page, { patientName: 'Lakshmi Murugan', symptoms: ['cough', 'runny_nose'] });
    await expect(page.getByTestId('result-level')).not.toHaveAttribute('data-level', 'EMERGENCY');

    await context.setOffline(false);
    await expect(page.getByTestId('verdict-changed')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('verdict-changed')).toContainText('EMERGENCY');
  });
});
