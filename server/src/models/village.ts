import { type InferSchemaType, model, Schema } from 'mongoose';

const villageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true, default: 'Tamil Nadu' },
    location: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },
    /**
     * Deactivated villages are hidden from new registrations and staff assignment. Their patients,
     * sessions and vitals are kept. Older documents have no field and count as active.
     */
    isActive: { type: Boolean, default: true },
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

villageSchema.index({ name: 1, district: 1 }, { unique: true });

export type VillageFields = InferSchemaType<typeof villageSchema>;
export const Village = model('Village', villageSchema);
