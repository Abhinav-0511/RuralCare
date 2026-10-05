// A tiny ONNX interpreter for the operators our exported model uses (LinearClassifier + Normalizer).
//
// Why: onnxruntime-web's smallest WebAssembly build is 14 MB (3.7 MB gzipped), downloaded over slow
// rural connections to run a 27 KB logistic-regression model. This reads the SAME .onnx file (so the
// sha256 version check still applies) in a few KB. Models with any other operator throw
// UnsupportedModelError and the app falls back to onnxruntime-web (see modelManager.ts).
// Parity with scikit-learn is tested in model.parity.test.ts, like onnxruntime-node.

export class UnsupportedModelError extends Error {}

// ───────────── minimal protobuf reader ─────────────

type Field = { no: number; wire: number; varint?: number; bytes?: Uint8Array; f32?: number };

function readFields(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 1;
    for (;;) {
      const b = buf[pos++]!;
      result += (b & 0x7f) * shift;
      if (b < 0x80) return result;
      shift *= 128;
    }
  };
  while (pos < buf.length) {
    const key = varint();
    const no = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) fields.push({ no, wire, varint: varint() });
    else if (wire === 2) {
      const len = varint();
      fields.push({ no, wire, bytes: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (wire === 5) {
      fields.push({ no, wire, f32: view.getFloat32(pos, true) });
      pos += 4;
    } else if (wire === 1) pos += 8;
    else throw new UnsupportedModelError(`Unsupported protobuf wire type ${wire}`);
  }
  return fields;
}

const text = (b?: Uint8Array) => (b ? new TextDecoder().decode(b) : '');

function packedFloats(fields: Field[], no: number): number[] {
  const out: number[] = [];
  for (const f of fields.filter((x) => x.no === no)) {
    if (f.wire === 5) out.push(f.f32!);
    else if (f.bytes) {
      const v = new DataView(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength);
      for (let i = 0; i < f.bytes.byteLength; i += 4) out.push(v.getFloat32(i, true));
    }
  }
  return out;
}

interface Attribute {
  name: string;
  f?: number;
  i?: number;
  s?: string;
  floats: number[];
}

interface Node {
  opType: string;
  inputs: string[];
  outputs: string[];
  attrs: Map<string, Attribute>;
}

function parseNode(buf: Uint8Array): Node {
  const fields = readFields(buf);
  const attrs = new Map<string, Attribute>();
  for (const a of fields.filter((f) => f.no === 5)) {
    const af = readFields(a.bytes!);
    const attr: Attribute = {
      name: text(af.find((x) => x.no === 1)?.bytes),
      floats: packedFloats(af, 7),
    };
    const f = af.find((x) => x.no === 2);
    const i = af.find((x) => x.no === 3);
    const s = af.find((x) => x.no === 4);
    if (f) attr.f = f.f32!;
    if (i) attr.i = i.varint!;
    if (s) attr.s = text(s.bytes);
    attrs.set(attr.name, attr);
  }
  return {
    opType: text(fields.find((f) => f.no === 4)?.bytes),
    inputs: fields.filter((f) => f.no === 1).map((f) => text(f.bytes)),
    outputs: fields.filter((f) => f.no === 2).map((f) => text(f.bytes)),
    attrs,
  };
}

// ───────────── operators ─────────────

type Matrix = { rows: number; cols: number; data: Float64Array };

const SUPPORTED = new Set(['LinearClassifier', 'Normalizer']);

function linearClassifier(node: Node, x: Matrix): Matrix {
  const coef = node.attrs.get('coefficients')?.floats ?? [];
  const intercepts = node.attrs.get('intercepts')?.floats ?? [];
  const classes = intercepts.length;
  if (!classes || coef.length !== classes * x.cols) {
    throw new UnsupportedModelError('LinearClassifier: unexpected coefficient shape');
  }
  const post = node.attrs.get('post_transform')?.s ?? 'NONE';
  const out = new Float64Array(x.rows * classes);
  for (let r = 0; r < x.rows; r++) {
    for (let c = 0; c < classes; c++) {
      let s = intercepts[c]!;
      for (let j = 0; j < x.cols; j++) {
        const v = x.data[r * x.cols + j]!;
        if (v !== 0) s += coef[c * x.cols + j]! * v;
      }
      out[r * classes + c] = s;
    }
    const row = out.subarray(r * classes, (r + 1) * classes);
    if (post === 'SOFTMAX') {
      const max = Math.max(...row);
      let sum = 0;
      for (let c = 0; c < classes; c++) sum += row[c] = Math.exp(row[c]! - max);
      for (let c = 0; c < classes; c++) row[c] = row[c]! / sum;
    } else if (post === 'LOGISTIC') {
      for (let c = 0; c < classes; c++) row[c] = 1 / (1 + Math.exp(-row[c]!));
    } else if (post !== 'NONE') {
      throw new UnsupportedModelError(`LinearClassifier post_transform ${post}`);
    }
  }
  return { rows: x.rows, cols: classes, data: out };
}

function normalizer(node: Node, x: Matrix): Matrix {
  const norm = node.attrs.get('norm')?.s ?? 'MAX';
  const out = new Float64Array(x.data);
  for (let r = 0; r < x.rows; r++) {
    const row = out.subarray(r * x.cols, (r + 1) * x.cols);
    let d = 0;
    for (const v of row)
      d = norm === 'L1' ? d + Math.abs(v) : norm === 'L2' ? d + v * v : Math.max(d, Math.abs(v));
    if (norm === 'L2') d = Math.sqrt(d);
    if (d > 0) for (let c = 0; c < row.length; c++) row[c] = row[c]! / d;
  }
  return { ...x, data: out };
}

// ───────────── model ─────────────

export interface LiteModel {
  /** Probabilities for each row of `x` (row-major, `cols` features). */
  run(x: Float32Array, rows: number, cols: number): Float64Array;
}

/** Parses an ONNX file. Throws UnsupportedModelError for operators this interpreter doesn't know. */
export function loadLiteModel(
  bytes: ArrayBuffer | Uint8Array,
  inputName: string,
  outputName: string,
): LiteModel {
  const model = readFields(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const graph = model.find((f) => f.no === 7)?.bytes;
  if (!graph) throw new UnsupportedModelError('No graph in ONNX file');
  const gf = readFields(graph);
  if (gf.some((f) => f.no === 5))
    throw new UnsupportedModelError('Graphs with initializers are not supported');
  const nodes = gf.filter((f) => f.no === 1).map((f) => parseNode(f.bytes!));
  const unsupported = nodes.filter((n) => !SUPPORTED.has(n.opType)).map((n) => n.opType);
  if (unsupported.length) throw new UnsupportedModelError(`Unsupported operators: ${unsupported.join(', ')}`);

  return {
    run(x, rows, cols) {
      const tensors = new Map<string, Matrix>([[inputName, { rows, cols, data: Float64Array.from(x) }]]);
      for (const node of nodes) {
        const input = tensors.get(node.inputs[0]!);
        if (!input) throw new UnsupportedModelError(`Missing tensor ${node.inputs[0]}`);
        const result =
          node.opType === 'LinearClassifier' ? linearClassifier(node, input) : normalizer(node, input);
        // LinearClassifier's first output is the label; the scores are the second.
        tensors.set(node.outputs[node.opType === 'LinearClassifier' ? 1 : 0]!, result);
      }
      const out = tensors.get(outputName);
      if (!out) throw new UnsupportedModelError(`Output ${outputName} not produced`);
      return out.data;
    },
  };
}
