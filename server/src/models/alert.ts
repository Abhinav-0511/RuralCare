import { ALERT_SEVERITIES, ALERT_VITALS, type AlertSeverity, type AlertVital } from '@ruralcare/shared';
import { model, Schema, type Types } from 'mongoose';

export interface AlertFields {
  patientId: Types.ObjectId;
  villageId: Types.ObjectId;
  deviceId: string;
  /** Threshold code from shared/data/vitals.json, e.g. SPO2_CRITICAL. */
  code: string;
  severity: AlertSeverity;
  vital: AlertVital;
  /** Latest value that breached the threshold. */
  value: number;
  threshold: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Readings that breached the threshold while the alert was open. */
  count: number;
  acknowledged: boolean;
  acknowledgedBy?: Types.ObjectId;
  acknowledgedAt?: Date;
  acknowledgeNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const alertSchema = new Schema<AlertFields>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    villageId: { type: Schema.Types.ObjectId, ref: 'Village', required: true },
    deviceId: { type: String, required: true },
    code: { type: String, required: true },
    severity: { type: String, enum: ALERT_SEVERITIES, required: true },
    vital: { type: String, enum: ALERT_VITALS, required: true },
    value: { type: Number, required: true },
    threshold: { type: Number, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    count: { type: Number, default: 1 },
    acknowledged: { type: Boolean, default: false },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: Date,
    acknowledgeNote: { type: String, trim: true, maxlength: 1000 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// At most one OPEN alert per patient and code: a reading every few seconds updates it instead of
// flooding health workers. After acknowledgement, a new breach opens a new alert.
alertSchema.index(
  { patientId: 1, code: 1 },
  { unique: true, partialFilterExpression: { acknowledged: false } },
);
alertSchema.index({ villageId: 1, acknowledged: 1, lastSeenAt: -1 });
alertSchema.index({ acknowledged: 1, severity: 1, lastSeenAt: -1 });

export const Alert = model<AlertFields>('Alert', alertSchema);
