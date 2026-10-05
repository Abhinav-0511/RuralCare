import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, request } from '@playwright/test';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
export const PASSWORD = 'RuralCare@123';
export const PHONES = {
  admin: '9000000001',
  doctor: '9000000002',
  hwKelambakkam: '9000000011', // Kelambakkam + Thiruporur
  patientLakshmi: '9000000021',
};

const REPO = resolve(import.meta.dirname, '..', '..');
const COMPOSE = `docker compose -f "${resolve(REPO, 'infra/docker-compose.yml')}"`;

export const compose = (args: string) =>
  execSync(`${COMPOSE} ${args}`, { stdio: 'pipe', timeout: 120_000 }).toString();

/** Publishes an abnormal reading from a demo device through MQTT (the real path). */
export const injectVitals = (deviceId: string, kind: string) =>
  compose(`exec -T edge-simulator python -m simulator inject --device ${deviceId} --kind ${kind}`);

export function deviceFor(patientName: string) {
  const file = resolve(REPO, 'infra/mosquitto/generated/devices.json');
  const devices = JSON.parse(readFileSync(file, 'utf8')).devices as {
    deviceId: string;
    patientId: string;
    patientName: string;
  }[];
  const d = devices.find((x) => x.patientName === patientName);
  if (!d) throw new Error(`No device for ${patientName}`);
  return d;
}

export async function apiAs(phone: string) {
  const ctx = await request.newContext({ baseURL: API_URL });
  const res = await ctx.post('/api/auth/login', { data: { phone, password: PASSWORD } });
  const { tokens } = await res.json();
  return {
    get: async (path: string) =>
      (await ctx.get(path, { headers: { authorization: `Bearer ${tokens.accessToken}` } })).json(),
  };
}

export async function login(page: Page, phone: string) {
  await page.goto('/login');
  await page.locator('input[name=phone]').fill(phone);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** The service worker controls the page and the model is stored on the device. */
export async function waitUntilOfflineReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByTestId('model-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
}

/** Runs the wizard as a health worker for `patientName`. */
export async function runTriage(
  page: Page,
  opts: {
    patientName?: string;
    areas?: string[];
    symptoms: string[];
    severity?: 'mild' | 'moderate' | 'severe';
  },
) {
  await page.getByRole('link', { name: /New triage/ }).click();
  if (opts.patientName) {
    await page.getByTestId('patient-option').filter({ hasText: opts.patientName }).click();
    // the dashboard link (?patient=) jumps ahead; from the nav we pick then continue
    if (await page.getByTestId('wizard-step-patient').isVisible())
      await page.getByTestId('wizard-next').click();
  }
  await expect(page.getByTestId('wizard-step-area')).toBeVisible();
  for (const a of opts.areas ?? []) await page.getByTestId(`area-${a}`).click();
  await page.getByTestId('wizard-next').click();
  for (const s of opts.symptoms) await page.getByTestId(`symptom-${s}`).click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-skip').click(); // duration
  if (opts.severity) {
    await page.getByTestId(`severity-${opts.severity}`).click();
    await page.getByTestId('wizard-next').click();
  } else {
    await page.getByTestId('wizard-skip').click();
  }
  await expect(page.getByTestId('wizard-step-person')).toBeVisible();
  await page.getByTestId('wizard-next').click(); // age/sex prefilled from the patient record
  await page.getByTestId('wizard-skip').click(); // vitals
  await page.getByTestId('wizard-submit').click();
  await expect(page.getByTestId('result-level')).toBeVisible();
}
