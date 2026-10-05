import { expect, type Page, test } from '@playwright/test';
import { API_URL, apiAs, login, PHONES, waitUntilOfflineReady } from './helpers';

/** The wizard without an account: nothing is prefilled, so age and sex are entered. */
async function runGuestTriage(page: Page, symptoms: string[]) {
  await expect(page.getByTestId('wizard-step-area')).toBeVisible();
  await page.getByTestId('wizard-next').click();
  for (const s of symptoms) await page.getByTestId(`symptom-${s}`).click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-skip').click(); // duration
  await page.getByTestId('wizard-skip').click(); // severity
  await page.getByTestId('age-years').fill('29');
  await page.getByTestId('sex-female').click();
  await page.getByTestId('pregnant-no').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-skip').click(); // vitals
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('result-level')).toBeVisible();
}

const totalSessions = async () =>
  (await (await apiAs(PHONES.admin)).get('/api/triage?limit=1')).total as number;

test('regression: a seeded patient logs in, runs a triage and gets an online model result as before', async ({
  page,
}) => {
  await login(page, PHONES.patientLakshmi);
  await expect(page.getByTestId('claim-prompt')).toHaveCount(0); // no guest checks on this device
  // The same wizard as before onboarding: no patient step, age and sex come from her record.
  await page.getByRole('link', { name: /New triage/ }).click();
  await expect(page.getByTestId('wizard-step-area')).toBeVisible();
  await page.getByTestId('area-chest').click();
  await page.getByTestId('wizard-next').click();
  for (const s of ['runny_nose', 'congestion', 'cough']) await page.getByTestId(`symptom-${s}`).click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-skip').click(); // duration
  await page.getByTestId('wizard-skip').click(); // severity
  await expect(page.getByTestId('age-years')).toHaveValue('34');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-skip').click(); // vitals
  await page.getByTestId('wizard-submit').click();

  await expect(page.getByTestId('result-source')).toHaveAttribute('data-source', 'online_model');
  await expect(page.getByTestId('result-level')).not.toHaveAttribute('data-level', 'EMERGENCY');
  await expect(page.getByTestId('possible-conditions')).toContainText('Common cold');
  await expect(page.getByTestId('disclaimer')).toContainText('not a medical diagnosis');
  const clientId = page.url().split('/result/')[1]!;

  // Saved to her record, as an ordinary online triage.
  const list = await (await apiAs(PHONES.hwKelambakkam)).get('/api/triage?limit=50');
  const saved = list.items.find((s: { clientId: string }) => s.clientId === clientId);
  expect(saved).toMatchObject({ origin: 'online', patientName: 'Lakshmi Murugan' });
});

test('guest red flag offline: EMERGENCY with Call 108, kept only on the phone', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByTestId('guest-start').click();
  await waitUntilOfflineReady(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('online-status')).toHaveAttribute('data-online', 'false');

  await runGuestTriage(page, ['chest_pain']);
  await expect(page.getByTestId('result-level')).toHaveAttribute('data-level', 'EMERGENCY');
  await expect(page.getByTestId('call-108')).toHaveAttribute('href', 'tel:108');
  await expect(page.getByTestId('result-source')).toHaveAttribute('data-source', 'rules');
  await expect(page.getByTestId('guest-not-saved')).toBeVisible();
  await expect(page.getByTestId('disclaimer')).toBeVisible();
});

test('guest triage → health worker registers the patient → patient logs in on the same phone → guest checks added', async ({
  page,
  browser,
}) => {
  const phone = `9${String(Date.now()).slice(-9)}`;
  const name = `Kaveri E2E ${phone.slice(-4)}`;

  // 1. On the patient's phone, without an account.
  const before = await totalSessions();
  await page.goto('/login');
  await page.getByTestId('guest-start').click();
  await runGuestTriage(page, ['runny_nose', 'congestion', 'cough']);
  await expect(page.getByTestId('guest-not-saved')).toContainText('Not saved to a health record');
  await expect(page.getByTestId('guest-register-hint')).toContainText(
    'To keep a health record, ask your village health worker to register you.',
  );
  await expect(page.getByTestId('result-source')).toHaveAttribute('data-source', 'online_model');
  expect(await totalSessions()).toBe(before); // nothing stored on the server

  // 2. On the health worker's own phone: register her, with a login.
  const hwContext = await browser.newContext();
  const hw = await hwContext.newPage();
  await login(hw, PHONES.hwKelambakkam);
  await hw.getByTestId('register-patient-button').click();
  await hw.locator('input[name=name]').fill(name);
  await hw.locator('input[name=phone]').fill(phone);
  await hw.locator('select[name=villageId]').selectOption({ label: 'Kelambakkam (Chengalpattu)' });
  await hw.getByTestId('reg-sex-female').click();
  await hw.locator('input[name=dateOfBirth]').fill('1997-04-12');
  await hw.locator('input[name=createLogin]').check();
  await hw.getByTestId('register-submit').click();
  await expect(hw.getByTestId('temp-phone')).toHaveText(phone);
  const temporaryPassword = (await hw.getByTestId('temp-password').textContent())!.trim();
  await hw.getByTestId('temp-done').click();
  await expect(hw.getByTestId('patients-list')).toContainText(name); // in her village list
  await hwContext.close();

  // 3. Back on her phone: first login forces a new password, then offers the guest check.
  await page.goto('/login');
  await page.locator('input[name=phone]').fill(phone);
  await page.locator('input[name=password]').fill(temporaryPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/change-password/);
  await page.locator('input[name=currentPassword]').fill(temporaryPassword);
  await page.locator('input[name=newPassword]').fill('Kaveri@2026');
  await page.locator('input[name=repeatPassword]').fill('Kaveri@2026');
  await page.getByTestId('save-password').click();

  await expect(page.getByTestId('claim-prompt')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('claim-prompt')).toContainText(
    'You have 1 earlier checks on this phone. Add them to your record?',
  );
  await page.getByTestId('claim-yes').click();
  await expect(page.getByTestId('claim-done')).toBeVisible();

  // The check is now in her record, marked as coming from a guest check.
  const list = await (await apiAs(PHONES.hwKelambakkam)).get('/api/triage?limit=50');
  const hers = list.items.filter((s: { patientName: string }) => s.patientName === name);
  expect(hers).toHaveLength(1);
  expect(hers[0]).toMatchObject({
    origin: 'guest',
    input: { symptoms: ['runny_nose', 'congestion', 'cough'] },
  });

  // The question isn't asked again, and the temporary password no longer works.
  await page.reload();
  await expect(page.getByTestId('result-level').or(page.getByTestId('wizard-step-area'))).toBeVisible();
  await expect(page.getByTestId('claim-prompt')).toHaveCount(0);
  const old = await page.request.post(`${API_URL}/api/auth/login`, {
    data: { phone, password: temporaryPassword },
  });
  expect(old.status()).toBe(401);
});
