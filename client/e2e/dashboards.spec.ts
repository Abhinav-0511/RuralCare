import { expect, test } from '@playwright/test';
import { deviceFor, injectVitals, login, PHONES } from './helpers';

test('health worker acknowledges an open vitals alert', async ({ page }) => {
  injectVitals(deviceFor('Arumugam Pillai').deviceId, 'spo2_critical'); // Thiruporur (this worker's village)
  await login(page, PHONES.hwKelambakkam);
  await expect(page).toHaveURL(/\/hw/);
  const alert = page.getByTestId('alert-item').filter({ hasText: 'Arumugam Pillai' }).first();
  await expect(alert).toContainText('Very low oxygen level');
  await alert.getByTestId('ack-alert').click();
  await expect(page.getByTestId('alert-item').filter({ hasText: 'Arumugam Pillai' })).toHaveCount(0);
});

test('doctor: review queue shows emergencies first; add a note and mark reviewed', async ({ page }) => {
  await login(page, PHONES.doctor);
  await expect(page).toHaveURL(/\/review/);
  const first = page.getByTestId('queue-item').first();
  await expect(first).toHaveAttribute('data-level', 'EMERGENCY');
  await first.click();
  await page.getByTestId('note-input').fill('Called the family; ambulance arranged.');
  await page.getByTestId('add-note').click();
  await expect(page.getByTestId('notes')).toContainText('ambulance arranged');
  await page.getByTestId('mark-reviewed').click();
  await expect(page.getByTestId('reviewed')).toBeVisible();
});

test('patient: vitals charts from hourly averages with threshold lines', async ({ page }) => {
  await login(page, PHONES.patientLakshmi);
  await page.getByRole('link', { name: /My health/ }).click();
  await expect(page.getByTestId('chart-spo2')).toBeVisible();
  await expect(page.getByTestId('chart-spo2')).toContainText('critical');
});

test('admin: dashboard stats by level, village and over time', async ({ page }) => {
  await login(page, PHONES.admin);
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByTestId('stat-tiles')).toBeVisible();
  await expect(page.getByTestId('chart-by-level')).toBeVisible();
  await expect(page.getByTestId('chart-admin.byVillage')).toContainText('Kelambakkam');
});

test('language switch on every screen, and no horizontal scrolling at 360 px', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'தமிழ்' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('உள்நுழைக');
  await page.locator('input[name=phone]').fill(PHONES.hwKelambakkam);
  await page.locator('input[name=password]').fill('RuralCare@123');
  await page.getByRole('button', { name: 'உள்நுழைக' }).click();
  await page.getByRole('link', { name: /புதிய மதிப்பீடு/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('யாருக்காக?');
  await page.getByRole('button', { name: 'हिन्दी' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('यह किसके लिए है?');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'English' }).click();
});
