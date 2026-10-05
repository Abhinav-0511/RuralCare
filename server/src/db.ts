import mongoose from 'mongoose';
import { Alert } from './models/alert';
import { Device } from './models/device';
import { Patient } from './models/patient';
import { TriageSession } from './models/triageSession';
import { User } from './models/user';
import { Village } from './models/village';

/** Builds indexes up front, so unique constraints (e.g. TriageSession.clientId) hold from the first request. */
export const initModels = () =>
  Promise.all([
    Village.init(),
    User.init(),
    Patient.init(),
    TriageSession.init(),
    Device.init(),
    Alert.init(),
  ]);

export async function connectDb(uri: string, dbName?: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, ...(dbName ? { dbName } : {}) });
  await initModels();
}

export const isDbConnected = () => mongoose.connection.readyState === 1;
