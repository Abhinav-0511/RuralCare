// IndexedDB (Dexie): everything the app needs offline.
import type { LocalizedText, ModelMetadata, TriageContext, TriageLevelId } from '@ruralcare/shared';
import Dexie, { type EntityTable } from 'dexie';

export type ResultSource = 'online_model' | 'offline_model' | 'rules' | 'rules_only';
export type SyncStatus = 'synced' | 'pending' | 'rejected';

export interface GuidanceView {
  title: LocalizedText;
  advice: LocalizedText;
  disclaimer: LocalizedText;
  notice?: LocalizedText;
  reasons: LocalizedText[];
  possibleConditions: {
    id: string;
    probability: number;
    triageLevel: string;
    name: LocalizedText;
    advice: LocalizedText;
  }[];
}

/** A triage done on this device (online or offline). Offline ones are the sync outbox. */
export interface LocalSession {
  clientId: string;
  patientId: string;
  patientName?: string;
  createdAt: string;
  input: TriageContext;
  level: TriageLevelId;
  source: ResultSource;
  rulesVersion: string;
  modelVersion?: string;
  guidance: GuidanceView;
  syncStatus: SyncStatus;
  attempts: number;
  nextAttemptAt?: number;
  lastError?: string;
  serverSessionId?: string;
  /** The server re-evaluates offline sessions; its verdict wins. */
  serverLevel?: TriageLevelId;
  verdictChanged?: boolean;
  /** The user has seen the "server result differs" notice. */
  differenceSeen?: boolean;
}

/**
 * A check made without an account (guest). Kept only on this device and never synced, unless a
 * patient later logs in here and chooses to add it to their record.
 */
export interface GuestCheck {
  clientId: string;
  createdAt: string;
  input: TriageContext;
  level: TriageLevelId;
  source: ResultSource;
  rulesVersion: string;
  modelVersion?: string;
  guidance: GuidanceView;
}

export interface CachedPatient {
  id: string;
  name: string;
  sex: 'female' | 'male' | 'other';
  dateOfBirth: string;
  ageMonths: number;
  villageId: string;
}

export interface StoredModel {
  key: 'current';
  metadata: ModelMetadata;
  bytes: ArrayBuffer;
  savedAt: string;
}

export class RuralCareDb extends Dexie {
  sessions!: EntityTable<LocalSession, 'clientId'>;
  patients!: EntityTable<CachedPatient, 'id'>;
  model!: EntityTable<StoredModel, 'key'>;
  guestChecks!: EntityTable<GuestCheck, 'clientId'>;

  constructor(name = 'ruralcare') {
    super(name);
    this.version(1).stores({
      sessions: 'clientId, syncStatus, createdAt, patientId',
      patients: 'id, name',
      model: 'key',
    });
    // v2 (onboarding) only adds a table; existing data is kept.
    this.version(2).stores({ guestChecks: 'clientId, createdAt' });
  }
}

export const db = new RuralCareDb();
