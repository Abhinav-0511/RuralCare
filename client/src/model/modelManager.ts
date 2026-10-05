import { type ModelMetadata, ModelMetadataSchema } from '@ruralcare/shared';
import { api } from '../lib/api';
import { MODEL_METADATA_URL, MODEL_URL } from '../lib/config';
import { db, type StoredModel } from '../lib/db';
import { loadLiteModel, UnsupportedModelError } from './onnxLite';

export interface Predictor {
  metadata: ModelMetadata;
  runtime: 'built-in' | 'onnxruntime-web';
  predict(vector: Float32Array): Promise<ArrayLike<number>>;
}

/** Built-in interpreter when the graph allows it; otherwise onnxruntime-web, loaded on demand. */
export async function createPredictor(bytes: ArrayBuffer, metadata: ModelMetadata): Promise<Predictor> {
  const n = metadata.features.length;
  try {
    const lite = loadLiteModel(bytes, metadata.onnx.inputName, metadata.onnx.outputName);
    return { metadata, runtime: 'built-in', predict: async (v) => lite.run(v, 1, n) };
  } catch (err) {
    if (!(err instanceof UnsupportedModelError)) throw err;
  }
  // CPU-only build (no WebGPU), downloaded only if a model needs operators onnxLite lacks.
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1; // threads need cross-origin isolation; one thread is plenty here
  const session = await ort.InferenceSession.create(new Uint8Array(bytes));
  return {
    metadata,
    runtime: 'onnxruntime-web',
    async predict(v) {
      const out = await session.run({ [metadata.onnx.inputName]: new ort.Tensor('float32', v, [1, n]) });
      return out[metadata.onnx.outputName]!.data as Float32Array;
    },
  };
}

export async function sha256Hex(data: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // only available in secure contexts (https / localhost)
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type UpdateResult =
  | { status: 'current'; metadata: ModelMetadata }
  | { status: 'updated'; metadata: ModelMetadata }
  | { status: 'unavailable'; reason: string };

/**
 * Downloads the model only when the server reports a different sha256 than the one stored on the
 * device (GET /api/model/version), and verifies the download against that hash.
 */
export async function updateModel(
  deps: {
    remoteVersion?: () => Promise<{ sha256: string } | null>;
    fetchFn?: typeof fetch;
  } = {},
): Promise<UpdateResult> {
  const fetchFn = deps.fetchFn ?? fetch.bind(globalThis);
  const remoteVersion =
    deps.remoteVersion ??
    (() => api<{ sha256: string }>('/api/model/version', { auth: false }).catch(() => null));

  const stored = await db.model.get('current');
  const remote = await remoteVersion();
  if (stored && (!remote || remote.sha256 === stored.metadata.sha256)) {
    return { status: 'current', metadata: stored.metadata };
  }

  try {
    const metaRes = await fetchFn(MODEL_METADATA_URL, { cache: 'no-cache' });
    if (!metaRes.ok) throw new Error(`metadata HTTP ${metaRes.status}`);
    const metadata = ModelMetadataSchema.parse(await metaRes.json());
    if (stored?.metadata.sha256 === metadata.sha256) return { status: 'current', metadata };
    if (remote && remote.sha256 !== metadata.sha256) {
      console.warn('The model served with the app differs from the server model; using the app copy.');
    }

    const modelRes = await fetchFn(MODEL_URL, { cache: 'no-cache' });
    if (!modelRes.ok) throw new Error(`model HTTP ${modelRes.status}`);
    const bytes = await modelRes.arrayBuffer();
    const hash = await sha256Hex(bytes);
    if (hash !== null && hash !== metadata.sha256)
      throw new Error('Downloaded model failed its sha256 check');
    await createPredictor(bytes, metadata); // make sure it actually loads before replacing the old one

    const record: StoredModel = { key: 'current', metadata, bytes, savedAt: new Date().toISOString() };
    await db.model.put(record);
    return { status: 'updated', metadata };
  } catch (err) {
    if (stored) return { status: 'current', metadata: stored.metadata };
    return { status: 'unavailable', reason: (err as Error).message };
  }
}

export async function loadStoredPredictor(): Promise<Predictor | null> {
  const stored = await db.model.get('current');
  return stored ? createPredictor(stored.bytes, stored.metadata) : null;
}
