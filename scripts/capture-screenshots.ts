// Screenshots of the running app for the project review deck. Not part of the test suite.
//
//   docker compose -f infra/docker-compose.yml up -d --wait
//   npx tsx scripts/capture-screenshots.ts
//
// Works against the existing demo data: it never re-seeds. Guest triages are not stored on the
// server, and the offline triage stays in a throwaway browser context that never comes back
// online. The only data it adds is one injected spo2_critical reading (and the alert it raises).
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
  request,
} from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'RuralCare@123';
const REPO = resolve(import.meta.dirname, '..');
const OUT = resolve(REPO, 'docs/screenshots');
const COMPOSE = `docker compose -f "${resolve(REPO, 'infra/docker-compose.yml')}"`;

const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

const PHONES = { admin: '9000000001', doctor: '9000000002', hw: '9000000011' };
const COLD = ['runny_nose', 'congestion', 'cough']; // SEE_DOCTOR_SOON for a 29-year-old guest

const expect = baseExpect.configure({ timeout: 30_000 });

function deviceFor(patientName: string) {
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

/** Publishes an abnormal reading through MQTT, then waits until the server has raised the alert. */
async function injectAndWaitForAlert(deviceId: string, patientId: string, kind: string) {
  const api = await request.newContext({ baseURL: API_URL });
  const res = await api.post('/api/auth/login', { data: { phone: PHONES.hw, password: PASSWORD } });
  const headers = { authorization: `Bearer ${(await res.json()).tokens.accessToken}` };
  const hasOpenAlert = async () => {
    const { items } = await (await api.get('/api/alerts?acknowledged=false&limit=50', { headers })).json();
    return items.some((a: { patientId: string }) => a.patientId === patientId);
  };
  // Re-runs reuse the open alert instead of bumping its count.
  if (await hasOpenAlert()) console.log(`  open alert for ${deviceId} already there, not injecting`);
  else {
    execSync(
      `${COMPOSE} exec -T edge-simulator python -m simulator inject --device ${deviceId} --kind ${kind}`,
      {
        stdio: 'inherit',
        timeout: 60_000,
      },
    );
    await expect.poll(hasOpenAlert).toBe(true);
  }
  await api.dispose();
}

/** Network quiet, web fonts loaded, nothing still spinning. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('p[role=status].p-6')).toHaveCount(0); // <Spinner />
  await page.waitForTimeout(300); // let transitions finish
}

const FIRST_SELECTED = '[data-testid^=symptom-][aria-pressed=true]';

/**
 * Viewport shots start from the top of the page (or from `scrollTo`, just under the sticky header). Full-page shots grow the viewport to the page's
 * height instead of using `fullPage`, so the fixed bottom navigation stays at the bottom.
 */
async function shot(page: Page, name: string, opts: { fullPage?: boolean; scrollTo?: string } = {}) {
  await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null;
    const header = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
    window.scrollTo(0, el ? el.getBoundingClientRect().top + window.scrollY - header - 16 : 0);
  }, opts.scrollTo);
  const size = page.viewportSize()!;
  if (opts.fullPage) {
    await settle(page);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: size.width, height: Math.max(height, size.height) });
  }
  await settle(page);
  await page.screenshot({ path: resolve(OUT, name) });
  await page.setViewportSize(size);
  console.log(`  saved ${name}`);
}

async function withPage(
  browser: Browser,
  size: typeof MOBILE | typeof DESKTOP,
  fn: (page: Page, context: BrowserContext) => Promise<void>,
) {
  const context = await browser.newContext({ ...size, baseURL: BASE_URL, serviceWorkers: 'allow' });
  try {
    await fn(await context.newPage(), context);
  } finally {
    await context.close();
  }
}

async function login(page: Page, phone: string) {
  await page.goto('/login');
  await page.locator('input[name=phone]').fill(phone);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function startGuest(page: Page) {
  await page.goto('/login');
  await page.getByTestId('guest-start').click();
  await expect(page.getByTestId('wizard-step-area')).toBeVisible();
}

/** Guest wizard up to the symptoms step, with `symptoms` ticked. */
async function guestToSymptoms(page: Page, symptoms: string[], areas: string[] = []) {
  await startGuest(page);
  for (const a of areas) await page.getByTestId(`area-${a}`).click();
  await page.getByTestId('wizard-next').click();
  await expect(page.getByTestId('wizard-step-symptoms')).toBeVisible();
  for (const s of symptoms) await page.getByTestId(`symptom-${s}`).click();
}

/** From the symptoms step to the result: no duration/severity, a 29-year-old woman, no vitals. */
async function guestFinish(page: Page) {
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

async function waitUntilOfflineReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByTestId('model-status')).toHaveAttribute('data-status', 'ready');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    console.log('Mobile 390x844');

    await withPage(browser, MOBILE, async (page) => {
      await guestToSymptoms(page, COLD, ['chest']);
      await shot(page, '01-wizard-mobile.png', { scrollTo: FIRST_SELECTED });
    });

    await withPage(browser, MOBILE, async (page) => {
      await guestToSymptoms(page, ['chest_pain']);
      await guestFinish(page);
      await expect(page.getByTestId('result-level')).toHaveAttribute('data-level', 'EMERGENCY');
      await expect(page.getByTestId('call-108')).toBeVisible();
      await shot(page, '02-emergency-mobile.png');
    });

    console.log('Desktop 1440x900');

    await withPage(browser, DESKTOP, async (page) => {
      await page.goto('/login');
      await expect(page.getByTestId('guest-start')).toBeVisible();
      await shot(page, '03-login.png');
    });

    await withPage(browser, DESKTOP, async (page) => {
      await guestToSymptoms(page, COLD, ['chest']);
      await shot(page, '04-wizard.png', { scrollTo: FIRST_SELECTED });
      await guestFinish(page);
      await expect(page.getByTestId('result-level')).toHaveAttribute('data-level', 'SEE_DOCTOR_SOON');
      await expect(page.getByTestId('possible-conditions')).toBeVisible();
      await expect(page.getByTestId('disclaimer')).toBeVisible();
      await shot(page, '05-result.png', { fullPage: true });
    });

    // A critical SpO2 from Arumugam Pillai's home device (Thiruporur, this health worker's area):
    // the open alert on the dashboard (06) and the dip on his vitals chart (08).
    const arumugam = deviceFor('Arumugam Pillai');
    await injectAndWaitForAlert(arumugam.deviceId, arumugam.patientId, 'spo2_critical');

    await withPage(browser, DESKTOP, async (page) => {
      await login(page, PHONES.hw);
      await expect(page).toHaveURL(/\/hw/);
      await expect(page.getByTestId('patients-list')).toBeVisible();
      await expect(page.getByTestId('alert-item').first()).toBeVisible();
      await shot(page, '06-health-worker-dashboard.png', { fullPage: true });
    });

    await withPage(browser, DESKTOP, async (page) => {
      await login(page, PHONES.doctor);
      await expect(page).toHaveURL(/\/review/);
      await expect(page.getByTestId('queue-item').first()).toBeVisible();
      await shot(page, '07-doctor-review.png');
    });

    await withPage(browser, DESKTOP, async (page) => {
      await login(page, PHONES.hw);
      await expect(
        page.getByTestId('alert-item').filter({ hasText: 'Arumugam Pillai' }).first(),
      ).toBeVisible();
      await page.goto(`/patients/${arumugam.patientId}`);
      await expect(page.getByTestId('chart-spo2')).toContainText('critical'); // threshold line labels
      await shot(page, '08-vitals-chart.png', { fullPage: true });
    });

    await withPage(browser, DESKTOP, async (page) => {
      await login(page, PHONES.admin);
      await page.goto('/admin/users');
      await expect(page.getByTestId('staff-item').first()).toBeVisible();
      await expect(page.getByTestId('village-item').first()).toBeVisible();
      await shot(page, '09-admin-users.png', { fullPage: true });
    });

    await withPage(browser, DESKTOP, async (page) => {
      await login(page, PHONES.hw);
      await page.getByTestId('register-patient-button').click();
      await expect(page.getByTestId('register-patient')).toBeVisible();
      await shot(page, '10-register-patient.png', { fullPage: true });
    });

    // Offline triage as the health worker: one session waits to sync. The context is closed while
    // still offline, so it never reaches the server.
    await withPage(browser, DESKTOP, async (page, context) => {
      await login(page, PHONES.hw);
      await waitUntilOfflineReady(page);
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByTestId('online-status')).toHaveAttribute('data-online', 'false');
      await page.getByRole('link', { name: /New triage/ }).click();
      await page.getByTestId('patient-option').filter({ hasText: 'Senthil Kumar' }).click();
      if (await page.getByTestId('wizard-step-patient').isVisible())
        await page.getByTestId('wizard-next').click();
      await page.getByTestId('wizard-next').click(); // area
      for (const s of COLD) await page.getByTestId(`symptom-${s}`).click();
      await page.getByTestId('wizard-next').click();
      await page.getByTestId('wizard-skip').click(); // duration
      await page.getByTestId('wizard-skip').click(); // severity
      await page.getByTestId('wizard-next').click(); // age/sex from the record
      await page.getByTestId('wizard-skip').click(); // vitals
      await page.getByTestId('wizard-submit').click();
      await expect(page.getByTestId('pending-count')).toHaveAttribute('data-count', '1');
      await expect(page.getByTestId('result-source')).toHaveAttribute('data-source', 'offline_model');
      // networkidle never settles offline; wait for the fonts and the layout instead
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(OUT, '11-offline.png') });
      console.log('  saved 11-offline.png');
    });

    await withPage(browser, DESKTOP, async (page) => {
      await startGuest(page);
      await page.getByRole('button', { name: 'தமிழ்' }).click();
      await page.getByTestId('area-chest').click();
      await page.getByTestId('wizard-next').click();
      await expect(page.getByTestId('wizard-step-symptoms')).toBeVisible();
      for (const s of COLD) await page.getByTestId(`symptom-${s}`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
      await shot(page, '12-tamil.png', { scrollTo: FIRST_SELECTED });
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
