import { model, Schema, type Types } from 'mongoose';

export interface DeviceFields {
  /** Also the device's MQTT username. */
  deviceId: string;
  patientId: Types.ObjectId;
  label?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const deviceSchema = new Schema<DeviceFields>(
  {
    deviceId: { type: String, required: true, unique: true, match: /^[a-z0-9-]{3,40}$/ },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    label: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Device = model<DeviceFields>('Device', deviceSchema);
