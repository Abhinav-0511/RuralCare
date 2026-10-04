import mongoose from 'mongoose';
import { Patient } from './models/patient';
import { TriageSession } from './models/triageSession';
import { User } from './models/user';
import { Village } from './models/village';

/** Builds indexes up front, so unique constraints (e.g. TriageSession.clientId) hold from the first request. */
export const initModels = () => Promise.all([Village, User, Patient, TriageSession].map((m) => m.init()));

export async function connectDb(uri: string, dbName?: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, ...(dbName ? { dbName } : {}) });
  await initModels();
}

export const isDbConnected = () => mongoose.connection.readyState === 1;
