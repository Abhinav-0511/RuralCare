import { SEXES } from '@ruralcare/shared';
import { type InferSchemaType, model, Schema } from 'mongoose';

const patientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sex: { type: String, enum: SEXES, required: true },
    dateOfBirth: { type: Date, required: true },
    villageId: { type: Schema.Types.ObjectId, ref: 'Village', required: true, index: true },
    phone: { type: String, trim: true },
    /** Set when the patient has their own login. Many patients are registered by a health worker instead. */
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    registeredBy: { type: Schema.Types.ObjectId, ref: 'User' },
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

export type PatientFields = InferSchemaType<typeof patientSchema>;
export const Patient = model('Patient', patientSchema);
