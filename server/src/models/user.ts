import { LOCALES } from '@ruralcare/shared';
import { type InferSchemaType, model, Schema } from 'mongoose';

export const ROLES = ['patient', 'health_worker', 'doctor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** 10-digit Indian mobile number, used as the login id. */
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    /** Villages a health worker serves (their access scope). */
    villageIds: [{ type: Schema.Types.ObjectId, ref: 'Village' }],
    /** For role=patient: the linked patient record. */
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
    preferredLanguage: { type: String, enum: LOCALES, default: 'en' },
    isActive: { type: Boolean, default: true },
    /** Incremented on logout/deactivation to revoke all issued tokens. */
    tokenVersion: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.tokenVersion;
        return ret;
      },
    },
  },
);

export type UserFields = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
