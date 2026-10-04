import {
  SEXES,
  TRIAGE_LEVELS,
  type TriageContext,
  type TriageLevelId,
  type TriageSource,
} from '@ruralcare/shared';
import { model, Schema, type Types } from 'mongoose';

export const SESSION_ORIGINS = ['online', 'offline_sync', 'seed'] as const;
export const TRIAGE_SOURCES = ['rule_engine', 'model', 'rule_engine_fallback'] as const;
export const MODEL_STATUSES = ['ok', 'unavailable', 'not_called'] as const;
export const REVIEW_STATUSES = ['pending', 'reviewed'] as const;

export interface SessionResult {
  level: TriageLevelId;
  source: TriageSource;
  redFlags: string[];
  safetyFloors: string[];
  rulesVersion: string;
  model: {
    status: (typeof MODEL_STATUSES)[number];
    modelVersion?: string;
    confidence?: number;
    reason?: string;
    lowConfidence?: boolean;
    topConditions: { id: string; probability: number }[];
  };
}

export interface ReviewNote {
  doctorId: Types.ObjectId;
  text: string;
  createdAt: Date;
}

export interface TriageSessionFields {
  clientId: string;
  patientId: Types.ObjectId;
  villageId: Types.ObjectId;
  performedBy: Types.ObjectId;
  origin: (typeof SESSION_ORIGINS)[number];
  occurredAt: Date;
  input: TriageContext;
  result: SessionResult;
  clientResult?: { level: TriageLevelId; source: TriageSource; rulesVersion: string; modelVersion?: string };
  verdictChanged: boolean;
  review: {
    status: (typeof REVIEW_STATUSES)[number];
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    notes: ReviewNote[];
  };
  createdAt: Date;
  updatedAt: Date;
}

const noteSchema = new Schema<ReviewNote>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

const triageSessionSchema = new Schema<TriageSessionFields>(
  {
    /** Client-generated UUID. Unique, so retried/duplicated uploads can't create duplicates. */
    clientId: { type: String, required: true, unique: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    /** Denormalised from the patient for scoping and village statistics. */
    villageId: { type: Schema.Types.ObjectId, ref: 'Village', required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    origin: { type: String, enum: SESSION_ORIGINS, required: true },
    /** When the triage actually happened (client time for offline sessions). Used for statistics. */
    occurredAt: { type: Date, required: true },

    input: {
      symptoms: { type: [String], default: [] },
      ageMonths: Number,
      sex: { type: String, enum: SEXES },
      pregnant: Boolean,
      temperatureC: Number,
    },

    /** The server's verdict (always wins over the client's). */
    result: {
      level: { type: String, enum: TRIAGE_LEVELS, required: true },
      source: { type: String, enum: TRIAGE_SOURCES, required: true },
      redFlags: { type: [String], default: [] },
      safetyFloors: { type: [String], default: [] },
      rulesVersion: { type: String, required: true },
      model: {
        status: { type: String, enum: MODEL_STATUSES, required: true },
        modelVersion: String,
        confidence: Number,
        reason: String,
        lowConfidence: Boolean,
        topConditions: [{ _id: false, id: String, probability: Number }],
      },
    },

    /** What the device showed offline, kept for audit. */
    clientResult: {
      level: { type: String, enum: TRIAGE_LEVELS },
      source: { type: String, enum: TRIAGE_SOURCES },
      rulesVersion: String,
      modelVersion: String,
    },
    /** True when the server's level differs from the level the device showed. */
    verdictChanged: { type: Boolean, default: false },

    review: {
      status: { type: String, enum: REVIEW_STATUSES, default: 'pending' },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
      notes: { type: [noteSchema], default: [] },
    },
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

triageSessionSchema.index({ occurredAt: -1 });
triageSessionSchema.index({ villageId: 1, occurredAt: -1 });
triageSessionSchema.index({ patientId: 1, occurredAt: -1 });
triageSessionSchema.index({ 'review.status': 1, occurredAt: -1 });

export const TriageSession = model<TriageSessionFields>('TriageSession', triageSessionSchema);
