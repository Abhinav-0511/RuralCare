import type { VitalAlert } from '@ruralcare/shared';
import type { Types } from 'mongoose';
import { Alert } from '../models/alert';

/**
 * Opens an alert per breached threshold, or updates the open one (one open alert per patient + code).
 * Returns the codes that were *newly* opened.
 */
export async function recordAlerts(args: {
  patientId: Types.ObjectId;
  villageId: Types.ObjectId;
  deviceId: string;
  at: Date;
  alerts: VitalAlert[];
}): Promise<string[]> {
  const opened: string[] = [];
  for (const a of args.alerts) {
    const filter = { patientId: args.patientId, code: a.code, acknowledged: false };
    const update = {
      $set: { value: a.value, lastSeenAt: args.at, deviceId: args.deviceId, severity: a.severity },
      $inc: { count: 1 },
      $setOnInsert: {
        villageId: args.villageId,
        vital: a.vital,
        threshold: a.threshold,
        firstSeenAt: args.at,
      },
    };
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await Alert.findOneAndUpdate(filter, update, {
          upsert: true,
          new: true,
          includeResultMetadata: true,
        });
        if (!res.lastErrorObject?.updatedExisting) opened.push(a.code);
        break;
      } catch (err) {
        // Two readings racing to open the same alert: the loser retries and updates the winner's.
        if ((err as { code?: number }).code !== 11000 || attempt > 0) throw err;
      }
    }
  }
  return opened;
}
