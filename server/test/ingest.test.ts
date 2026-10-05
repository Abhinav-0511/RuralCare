import { beforeEach, describe, expect, it } from 'vitest';
import { Alert } from '../src/models/alert';
import { Device } from '../src/models/device';
import { Patient } from '../src/models/patient';
import { createVitalsHandler, parseTopic, type VitalsHandler } from '../src/vitals/ingest';
import { buildWorld, hasDocker, minutesAgo, useTestDb, useVitalsStore, type World } from './helpers';

useTestDb();
const store = useVitalsStore();
const PREFIX = 'ruralcare/vitals';

describe('parseTopic', () => {
  it('extracts patient and device', () => {
    expect(parseTopic(PREFIX, `${PREFIX}/665f00000000000000000a01/rc-dev-01`)).toEqual({
      patientId: '665f00000000000000000a01',
      deviceId: 'rc-dev-01',
    });
  });
  it.each([
    `${PREFIX}/abc/rc-dev-01`,
    `${PREFIX}/665f00000000000000000a01`,
    `other/665f00000000000000000a01/x`,
  ])('rejects %s', (t) => expect(parseTopic(PREFIX, t)).toBeNull());
});

describe.skipIf(!hasDocker())('vitals ingestion (handler → TimescaleDB + alerts)', () => {
  let world: World;
  let handler: VitalsHandler;
  let topic: string;
  const send = (body: object, t = topic) => handler.handle(t, Buffer.from(JSON.stringify(body)));
  const reading = (vitals: object, at = new Date()) => ({ ts: at.toISOString(), ...vitals });

  beforeEach(async () => {
    world = await buildWorld();
    await Device.create({ deviceId: 'rc-dev-01', patientId: world.patients.p1._id });
    handler = createVitalsHandler({ store: store(), topicPrefix: PREFIX });
    topic = `${PREFIX}/${world.patients.p1.id}/rc-dev-01`;
  });

  it('stores a normal reading without alerts', async () => {
    const r = await send(
      reading({ heartRate: 78, spo2: 97, temperatureC: 36.8, systolicBp: 122, diastolicBp: 80 }),
    );
    expect(r).toEqual({ status: 'stored', alerts: [], openedAlerts: [] });
    const latest = await store().latest(world.patients.p1.id, minutesAgo(1), new Date());
    expect(latest).toMatchObject({ heartRate: 78, spo2: 97, temperatureC: 36.8 });
    expect(await Alert.countDocuments()).toBe(0);
  });

  it('opens a critical alert for SpO2 < 90 and updates it on repeat breaches', async () => {
    const first = await send(reading({ spo2: 88 }, minutesAgo(1)));
    expect(first).toMatchObject({
      status: 'stored',
      alerts: ['SPO2_CRITICAL'],
      openedAlerts: ['SPO2_CRITICAL'],
    });
    const second = await send(reading({ spo2: 86 }));
    expect(second).toMatchObject({ alerts: ['SPO2_CRITICAL'], openedAlerts: [] });

    const alerts = await Alert.find();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      code: 'SPO2_CRITICAL',
      severity: 'critical',
      value: 86,
      threshold: 90,
      count: 2,
    });
    expect(String(alerts[0]!.villageId)).toBe(world.villages.v1.id);
  });

  it.each([
    [{ spo2: 91 }, 'SPO2_LOW'],
    [{ temperatureC: 39.5 }, 'TEMP_HIGH'],
    [{ heartRate: 155 }, 'HR_CRITICAL_HIGH'],
    [{ heartRate: 38 }, 'HR_CRITICAL_LOW'],
    [{ systolicBp: 185, diastolicBp: 95 }, 'BP_SYSTOLIC_CRITICAL'],
  ])('threshold %o raises %s', async (vitals, code) => {
    expect(await send(reading(vitals))).toMatchObject({ alerts: [code] });
  });

  it("uses the patient's age band: a baby's normal heart rate raises nothing", async () => {
    const baby = await Patient.create({
      name: 'Baby',
      sex: 'male',
      dateOfBirth: new Date(Date.now() - 200 * 24 * 3600 * 1000),
      villageId: world.villages.v1._id,
    });
    await Device.create({ deviceId: 'rc-dev-02', patientId: baby._id });
    const babyTopic = `${PREFIX}/${baby.id}/rc-dev-02`;
    expect(await send(reading({ heartRate: 145 }), babyTopic)).toMatchObject({
      status: 'stored',
      alerts: [],
    });
    expect(await send(reading({ heartRate: 205 }, minutesAgo(1)), babyTopic)).toMatchObject({
      alerts: ['HR_CRITICAL_HIGH_CHILD'],
    });
    // the same 145 bpm for the adult patient is an alert
    expect(await send(reading({ heartRate: 145 }))).toMatchObject({ alerts: ['HR_HIGH'] });
  });

  it('after acknowledgement, a new breach opens a new alert', async () => {
    await send(reading({ spo2: 88 }, minutesAgo(2)));
    await Alert.updateMany({}, { acknowledged: true });
    const r = await send(reading({ spo2: 87 }));
    expect(r).toMatchObject({ openedAlerts: ['SPO2_CRITICAL'] });
    expect(await Alert.countDocuments()).toBe(2);
  });

  it('a redelivered message is stored once and does not bump the alert', async () => {
    const msg = reading({ spo2: 88 });
    await send(msg);
    expect(await send(msg)).toEqual({ status: 'duplicate' });
    expect((await Alert.findOne())!.count).toBe(1);
  });

  it.each([
    ['an unknown device', () => `${PREFIX}/${world.patients.p1.id}/rc-dev-99`, 'unknown or inactive device'],
    [
      "another patient's topic",
      () => `${PREFIX}/${world.patients.p2.id}/rc-dev-01`,
      'device is not assigned to this patient',
    ],
    ['a bad topic', () => `${PREFIX}/nope`, 'bad topic'],
  ])('rejects %s', async (_name, t, reason) => {
    expect(await send(reading({ spo2: 97 }), t())).toEqual({ status: 'rejected', reason });
  });

  it('picks up a device re-assignment immediately (no stale cache)', async () => {
    expect(await send(reading({ spo2: 97 }, minutesAgo(1)))).toMatchObject({ status: 'stored' });
    await Device.updateOne({ deviceId: 'rc-dev-01' }, { patientId: world.patients.p2._id });
    const p2Topic = `${PREFIX}/${world.patients.p2.id}/rc-dev-01`;
    expect(await send(reading({ spo2: 96 }), p2Topic)).toMatchObject({ status: 'stored' });
    // ...and the old assignment is now rejected
    expect(await send(reading({ spo2: 95 }, minutesAgo(2)))).toMatchObject({ status: 'rejected' });
  });

  it('rejects an inactive device', async () => {
    await Device.updateOne({ deviceId: 'rc-dev-01' }, { active: false });
    handler = createVitalsHandler({ store: store(), topicPrefix: PREFIX });
    expect(await send(reading({ spo2: 97 }))).toMatchObject({ status: 'rejected' });
  });

  it.each([
    ['implausible SpO2', { ts: new Date().toISOString(), spo2: 150 }],
    ['no vitals', { ts: new Date().toISOString() }],
    ['unknown field', { ts: new Date().toISOString(), spo2: 97, pulse: 70 }],
    ['future timestamp', { ts: new Date(Date.now() + 3_600_000).toISOString(), spo2: 97 }],
  ])('rejects %s', async (_name, body) => {
    expect(await send(body)).toMatchObject({ status: 'rejected' });
  });

  it('rejects invalid JSON', async () => {
    expect(await handler.handle(topic, Buffer.from('{oops'))).toEqual({
      status: 'rejected',
      reason: 'invalid JSON',
    });
  });
});
