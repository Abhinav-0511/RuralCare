// Turns MQTT messages from vitals devices into TimescaleDB rows and MongoDB alerts.
import { evaluateVitalAlerts, VitalsSchema } from '@ruralcare/shared';
import { Types } from 'mongoose';
import mqtt from 'mqtt';
import { z } from 'zod';
import { Device } from '../models/device';
import { Patient } from '../models/patient';
import { recordAlerts } from './alerts';
import type { VitalsStore } from './store';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEVICE_CACHE_MS = 60 * 1000;

/** Message body published by a device. Ranges reject obviously broken sensor values. */
export const VitalPayloadSchema = VitalsSchema.extend({
  ts: z.iso.datetime({ offset: true }),
  temperatureC: z.number().min(30).max(45).optional(),
})
  .strict()
  .refine((p) => Object.keys(p).length > 1, 'A reading needs at least one vital');
export type VitalPayload = z.infer<typeof VitalPayloadSchema>;

/** `<prefix>/<patientId>/<deviceId>` — the broker ACL only lets a device publish to its own topic. */
export function parseTopic(prefix: string, topic: string): { patientId: string; deviceId: string } | null {
  const rest = topic.startsWith(`${prefix}/`) ? topic.slice(prefix.length + 1).split('/') : [];
  if (rest.length !== 2 || !/^[a-f\d]{24}$/i.test(rest[0]!) || !rest[1]) return null;
  return { patientId: rest[0]!, deviceId: rest[1] };
}

export type IngestResult =
  | { status: 'stored'; alerts: string[]; openedAlerts: string[] }
  | { status: 'duplicate' }
  | { status: 'rejected'; reason: string };

interface DeviceInfo {
  patientId: string;
  villageId: Types.ObjectId;
}

export function createVitalsHandler(deps: { store: VitalsStore; topicPrefix: string; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  const cache = new Map<string, DeviceInfo | null>();
  const cacheExpiry = new Map<string, number>();

  async function lookupDevice(deviceId: string): Promise<DeviceInfo | null> {
    if ((cacheExpiry.get(deviceId) ?? 0) > Date.now()) return cache.get(deviceId) ?? null;
    const device = await Device.findOne({ deviceId, active: true }).lean();
    const patient = device ? await Patient.findById(device.patientId).select('villageId').lean() : null;
    const info =
      device && patient ? { patientId: String(device.patientId), villageId: patient.villageId } : null;
    cache.set(deviceId, info);
    cacheExpiry.set(deviceId, Date.now() + DEVICE_CACHE_MS);
    return info;
  }

  return {
    clearCache: () => {
      cache.clear();
      cacheExpiry.clear();
    },

    async handle(topic: string, payload: Buffer | string): Promise<IngestResult> {
      const target = parseTopic(deps.topicPrefix, topic);
      if (!target) return { status: 'rejected', reason: 'bad topic' };

      let body: unknown;
      try {
        body = JSON.parse(payload.toString());
      } catch {
        return { status: 'rejected', reason: 'invalid JSON' };
      }
      const parsed = VitalPayloadSchema.safeParse(body);
      if (!parsed.success) return { status: 'rejected', reason: 'invalid payload' };
      const time = new Date(parsed.data.ts);
      if (time.getTime() > now().getTime() + MAX_CLOCK_SKEW_MS) {
        return { status: 'rejected', reason: 'timestamp in the future' };
      }

      // Defence in depth behind the broker ACL: the device must be registered to this patient.
      const device = await lookupDevice(target.deviceId);
      if (!device) return { status: 'rejected', reason: 'unknown or inactive device' };
      if (device.patientId !== target.patientId) {
        return { status: 'rejected', reason: 'device is not assigned to this patient' };
      }

      const { ts: _ts, ...reading } = parsed.data;
      const inserted = await deps.store.insert({ ...reading, time, ...target });
      if (!inserted) return { status: 'duplicate' };

      const alerts = evaluateVitalAlerts(reading);
      const openedAlerts = alerts.length
        ? await recordAlerts({
            patientId: new Types.ObjectId(target.patientId),
            villageId: device.villageId,
            deviceId: target.deviceId,
            at: time,
            alerts,
          })
        : [];
      return { status: 'stored', alerts: alerts.map((a) => a.code), openedAlerts };
    },
  };
}

export type VitalsHandler = ReturnType<typeof createVitalsHandler>;

/** Subscribes to every device topic with the server's (read-only) MQTT account. */
export function startMqttIngestor(options: {
  url: string;
  username: string;
  password?: string;
  topicPrefix: string;
  handler: VitalsHandler;
  log?: (msg: string) => void;
}) {
  const log = options.log ?? ((m: string) => console.log(`[mqtt] ${m}`));
  const client = mqtt.connect(options.url, {
    username: options.username,
    ...(options.password ? { password: options.password } : {}),
    clientId: `ruralcare-server-${Math.random().toString(16).slice(2, 10)}`,
    protocolVersion: 5,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
  });
  const stats = { stored: 0, duplicate: 0, rejected: 0 };

  client.on('connect', () => {
    log(`connected to ${options.url}`);
    client.subscribe(`${options.topicPrefix}/+/+`, { qos: 1 }, (err) => {
      if (err) log(`subscribe failed: ${err.message}`);
    });
  });
  client.on('error', (err) => log(`error: ${err.message}`));
  client.on('message', (topic, payload) => {
    options.handler
      .handle(topic, payload)
      .then((r) => {
        stats[r.status] += 1;
        if (r.status === 'rejected') log(`rejected ${topic}: ${r.reason}`);
        if (r.status === 'stored' && r.openedAlerts.length)
          log(`alert ${r.openedAlerts.join(',')} on ${topic}`);
      })
      .catch((err: Error) => log(`failed to store ${topic}: ${err.message}`));
  });

  return {
    client,
    stats,
    isConnected: () => client.connected,
    stop: () => client.endAsync(),
  };
}
export type MqttIngestor = ReturnType<typeof startMqttIngestor>;
