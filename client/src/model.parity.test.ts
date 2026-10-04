// @vitest-environment node
// The ONNX file the PWA serves must give the same probabilities as scikit-learn did at export time.
// onnxruntime-node uses the same ONNX Runtime kernels as onnxruntime-web (Phase 5), and the input is
// built with the shared buildFeatureVector() that the browser will use.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildFeatureVector, ModelMetadataSchema, predictionLevel, rankConditions } from '@ruralcare/shared';
import * as ort from 'onnxruntime-node';
import { beforeAll, describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url));

const modelBytes = read('../public/models/triage_model.onnx');
const metadata = ModelMetadataSchema.parse(
  JSON.parse(read('../public/models/model_metadata.json').toString()),
);
const fixtures = JSON.parse(read('../../ai-service/models/parity_fixtures.json').toString()) as {
  sha256: string;
  tolerance: number;
  cases: { symptoms: string[]; probabilities: number[] }[];
};

let session: ort.InferenceSession;
beforeAll(async () => {
  session = await ort.InferenceSession.create(modelBytes);
});

async function run(symptomSets: string[][]): Promise<Float32Array> {
  const n = metadata.features.length;
  const input = new Float32Array(symptomSets.length * n);
  symptomSets.forEach((s, row) => input.set(buildFeatureVector(s, metadata.features).vector, row * n));
  const output = await session.run({
    [metadata.onnx.inputName]: new ort.Tensor('float32', input, [symptomSets.length, n]),
  });
  return output[metadata.onnx.outputName]!.data as Float32Array;
}

describe('ONNX model served to the PWA', () => {
  it('is the exact file described by its metadata and the fixtures', () => {
    const sha = createHash('sha256').update(modelBytes).digest('hex');
    expect(sha).toBe(metadata.sha256);
    expect(fixtures.sha256).toBe(metadata.sha256);
    expect(modelBytes.length).toBe(metadata.sizeBytes);
    expect(modelBytes.length).toBeLessThan(2 * 1024 * 1024);
  });

  it('onnxruntime-node reproduces the scikit-learn probabilities', async () => {
    const k = metadata.classes.length;
    const probs = await run(fixtures.cases.map((c) => c.symptoms));
    expect(probs.length).toBe(fixtures.cases.length * k);

    let maxDiff = 0;
    fixtures.cases.forEach((c, row) => {
      const got = probs.subarray(row * k, (row + 1) * k);
      c.probabilities.forEach((p, i) => (maxDiff = Math.max(maxDiff, Math.abs(got[i]! - p))));
      const argmax = (xs: ArrayLike<number>) => Array.from(xs).indexOf(Math.max(...Array.from(xs)));
      expect(argmax(got), c.symptoms.join(',')).toBe(argmax(c.probabilities));
    });
    expect(maxDiff).toBeLessThan(fixtures.tolerance);
  });

  it('works end to end with the shared ranking and policy', async () => {
    const symptoms = ['runny_nose', 'congestion', 'sinus_pressure', 'loss_of_smell', 'cough'];
    const probs = await run([symptoms]);
    const ranked = rankConditions(probs, metadata.classes);
    expect(ranked[0]!.id).toBe('common_cold');
    const fv = buildFeatureVector(symptoms, metadata.features);
    expect(['SELF_CARE', 'SEE_DOCTOR_SOON']).toContain(predictionLevel(ranked, fv).level);
  });
});
