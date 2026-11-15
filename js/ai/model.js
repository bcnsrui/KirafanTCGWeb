/* The policy / value network (kirafan_ai.bridge.npmodel.NumpyPolicy) for one observation: a small pre-norm
 * transformer over [global token] + card tokens + option tokens; each option token gives a logit, the global one
 * the value. Weights: data/ai/model.bin (tools/build_ai.py). */
const NOOP_MASK = -1e8;

/** x [n, in] (rows) @ W.T + b, W [out, in] */
function linear(x, n, inDim, w, b) {
  const outDim = w.shape[0];
  const W = w.data, B = b.data;
  const y = new Float32Array(n * outDim);
  for (let r = 0; r < n; r++) {
    const xo = r * inDim, yo = r * outDim;
    for (let o = 0; o < outDim; o++) {
      let s = B[o];
      const wo = o * inDim;
      for (let i = 0; i < inDim; i++) s += x[xo + i] * W[wo + i];
      y[yo + o] = s;
    }
  }
  return y;
}

function relu(x) {
  for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0;
  return x;
}

function layerNorm(x, n, d, w, b, eps = 1e-5) {
  const y = new Float32Array(n * d);
  for (let r = 0; r < n; r++) {
    const o = r * d;
    let mu = 0;
    for (let i = 0; i < d; i++) mu += x[o + i];
    mu /= d;
    let v = 0;
    for (let i = 0; i < d; i++) v += (x[o + i] - mu) ** 2;
    v /= d;
    const s = 1 / Math.sqrt(v + eps);
    for (let i = 0; i < d; i++) y[o + i] = (x[o + i] - mu) * s * w.data[i] + b.data[i];
  }
  return y;
}

export class Network {
  constructor(model) {
    this.w = model.w;
    this.layers = model.config.layers;
    this.heads = model.config.heads;
    this.d = model.config.d;
    this.codeDim = model.config.code_dim || 64;
  }

  mlp(x, n, inDim, name) {
    const h = relu(linear(x, n, inDim, this.w[`${name}.0.weight`], this.w[`${name}.0.bias`]));
    return linear(h, n, this.w[`${name}.0.weight`].shape[0], this.w[`${name}.2.weight`], this.w[`${name}.2.bias`]);
  }

  emb(name, idx) {
    const t = this.w[`${name}.weight`];
    const dim = t.shape[1];
    return t.data.subarray(idx * dim, idx * dim + dim);
  }

  attention(x, n, p) {
    const d = this.d, h = this.heads, dh = d / h;
    const qkv = linear(x, n, d, this.w[`${p}in_proj_weight`], this.w[`${p}in_proj_bias`]);
    const out = new Float32Array(n * d);
    const scale = 1 / Math.sqrt(dh);
    const scores = new Float64Array(n);
    for (let head = 0; head < h; head++) {
      const qo = head * dh, ko = d + head * dh, vo = 2 * d + head * dh;
      for (let i = 0; i < n; i++) {
        let max = -Infinity;
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let k = 0; k < dh; k++) s += qkv[i * 3 * d + qo + k] * qkv[j * 3 * d + ko + k];
          s *= scale;
          scores[j] = s;
          if (s > max) max = s;
        }
        let total = 0;
        for (let j = 0; j < n; j++) {
          scores[j] = Math.exp(scores[j] - max);
          total += scores[j];
        }
        for (let k = 0; k < dh; k++) {
          let s = 0;
          for (let j = 0; j < n; j++) s += scores[j] * qkv[j * 3 * d + vo + k];
          out[i * d + head * dh + k] = s / total;
        }
      }
    }
    return linear(out, n, d, this.w[`${p}out_proj.weight`], this.w[`${p}out_proj.bias`]);
  }

  /** enc: features.encode's output -> { logits: [per option], value } */
  forward(enc) {
    const d = this.d;
    const hint = enc.hint;
    const gIn = Float32Array.from([...enc.g, ...this.emb("code_emb", hint[0]), ...this.emb("hint_idx_emb", Math.min(Math.max(hint[1], 0), 31))]);
    const g = this.mlp(gIn, 1, gIn.length, "g_in");
    const nc = enc.card_codes.length;
    let c = new Float32Array(0);
    if (nc) {
      const cdim = enc.cards[0].length + this.codeDim;
      const cIn = new Float32Array(nc * cdim);
      enc.cards.forEach((row, i) => {
        cIn.set(row, i * cdim);
        cIn.set(this.emb("code_emb", enc.card_codes[i]), i * cdim + row.length);
      });
      c = this.mlp(cIn, nc, cdim, "c_in");
    }
    const no = enc.opts.length;
    const odim = enc.opts[0].length + 2 * this.codeDim + 32 + 16;
    const oIn = new Float32Array(no * odim);
    enc.opts.forEach((row, i) => {
      const ids = enc.opt_ids[i];
      let at = i * odim;
      oIn.set(row, at);
      at += row.length;
      oIn.set(this.emb("code_emb", ids[1]), at);
      at += this.codeDim;
      oIn.set(this.emb("code_emb", ids[2]), at);
      at += this.codeDim;
      oIn.set(this.emb("kind_emb", ids[0]), at);
      at += 32;
      oIn.set(this.emb("desc_idx_emb", Math.min(Math.max(ids[3], 0), 31)), at);
    });
    const o = this.mlp(oIn, no, odim, "o_in");
    for (let i = 0; i < no; i++) {
      const ptr = Math.min(Math.max(enc.opt_ids[i][4], 0), nc);
      if (ptr > 0) for (let k = 0; k < d; k++) o[i * d + k] += c[(ptr - 1) * d + k];
    }
    const t = this.w["type_emb.weight"].data;
    const n = 1 + nc + no;
    let seq = new Float32Array(n * d);
    for (let k = 0; k < d; k++) seq[k] = g[k] + t[k];
    for (let i = 0; i < nc; i++) for (let k = 0; k < d; k++) seq[(1 + i) * d + k] = c[i * d + k] + t[d + k];
    for (let i = 0; i < no; i++) for (let k = 0; k < d; k++) seq[(1 + nc + i) * d + k] = o[i * d + k] + t[2 * d + k];
    for (let l = 0; l < this.layers; l++) {
      const p = `encoder.layers.${l}.`;
      const a = this.attention(layerNorm(seq, n, d, this.w[`${p}norm1.weight`], this.w[`${p}norm1.bias`]), n, `${p}self_attn.`);
      for (let i = 0; i < seq.length; i++) seq[i] += a[i];
      const y = layerNorm(seq, n, d, this.w[`${p}norm2.weight`], this.w[`${p}norm2.bias`]);
      const h1 = relu(linear(y, n, d, this.w[`${p}linear1.weight`], this.w[`${p}linear1.bias`]));
      const h2 = linear(h1, n, this.w[`${p}linear1.weight`].shape[0], this.w[`${p}linear2.weight`], this.w[`${p}linear2.bias`]);
      for (let i = 0; i < seq.length; i++) seq[i] += h2[i];
    }
    const h = layerNorm(seq, n, d, this.w["norm.weight"], this.w["norm.bias"]);
    const value = this.mlp(h.subarray(0, d), 1, d, "value")[0];
    const lg = this.mlp(h.subarray((1 + nc) * d), no, d, "logit");
    const logits = Array.from(lg, (x, i) => (enc.noop[i] > 0.5 ? NOOP_MASK : x));
    return { logits, value };
  }
}

export function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}
