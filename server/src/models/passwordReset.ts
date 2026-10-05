import { type InferSchemaType, model, Schema } from 'mongoose';

/**
 * One OTP request for "forgot password". A document is stored for EVERY request, including
 * unknown phone numbers (userId = null), so rate limits and response timing are the same either
 * way and never reveal which numbers have an account.
 */
const passwordResetSchema = new Schema(
  {
    phone: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** HMAC of the code; the code itself is never stored. */
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    /** Set when used, superseded by a newer code, or out of attempts. */
    closedAt: { type: Date, default: null },
    /** Kept a day for the per-phone rate limit and audit, then removed by MongoDB. */
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true },
);
passwordResetSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export type PasswordResetFields = InferSchemaType<typeof passwordResetSchema>;
export const PasswordReset = model('PasswordReset', passwordResetSchema);
