// @vitest-environment node
// The built-in interpreter must give the same probabilities as scikit-learn (and onnxruntime-node).
import { readFileSync } from 'node:fs';
import { buildFeatureVector, ModelMetadataSchema } from '@ruralcare/shared';
import * as ort from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import { loadLiteModel, UnsupportedModelError } from './onnxLite';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url));
const modelBytes = read('../../public/models/triage_model.onnx');
const metadata = ModelMetadataSchema.parse(
  JSON.parse(read('../../public/models/model_metadata.json').toString()),
);
const fixtures = JSON.parse(read('../../../ai-service/models/parity_fixtures.json').toString()) as {
  tolerance: number;
  cases: { symptoms: string[]; probabilities: number[] }[];
};

const n = metadata.features.length;
const k = metadata.classes.length;
const batch = () => {
  const x = new Float32Array(fixtures.cases.length * n);
  fixtures.cases.forEach((c, row) =>
    x.set(buildFeatureVector(c.symptoms, metadata.features).vector, row * n),
  );
  return x;
};

describe('onnxLite interpreter', () => {
  const model = loadLiteModel(modelBytes, metadata.onnx.inputName, metadata.onnx.outputName);

  it('reproduces the scikit-learn probabilities for every fixture', () => {
    const probs = model.run(batch(), fixtures.cases.length, n);
    let maxDiff = 0;
    fixtures.cases.forEach((c, row) => {
      c.probabilities.forEach((p, i) => (maxDiff = Math.max(maxDiff, Math.abs(probs[row * k + i]! - p))));
    });
    expect(maxDiff).toBeLessThan(fixtures.tolerance);
  });

  it('matches onnxruntime-node', async () => {
    const session = await ort.InferenceSession.create(modelBytes);
    const x = batch();
    const out = await session.run({
      [metadata.onnx.inputName]: new ort.Tensor('float32', x, [fixtures.cases.length, n]),
    });
    const expected = out[metadata.onnx.outputName]!.data as Float32Array;
    const got = model.run(x, fixtures.cases.length, n);
    expect(Math.max(...Array.from(got, (v, i) => Math.abs(v - expected[i]!)))).toBeLessThan(1e-5);
  });

  it('rows sum to 1', () => {
    const probs = model.run(new Float32Array(n), 1, n);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('rejects files it cannot run (the app then falls back to onnxruntime-web)', () => {
    expect(() => loadLiteModel(new Uint8Array([0x0a, 0x00]), 'x', 'y')).toThrow(UnsupportedModelError);
  });
});
