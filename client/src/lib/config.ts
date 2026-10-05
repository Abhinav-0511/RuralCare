/** API origin, baked in at build time (VITE_API_URL). */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Static model files served next to the app (cached in IndexedDB after the first download). */
export const MODEL_URL = '/models/triage_model.onnx';
export const MODEL_METADATA_URL = '/models/model_metadata.json';

export const EMERGENCY_TEL = 'tel:108';
