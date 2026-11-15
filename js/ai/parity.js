/* Checks the port against the Python AI on training's simulator states (data/ai/test/samples.jsonl,
 * tools/ai_samples.py) - from the browser console of any page of the site:
 *   (await import("./js/ai/parity.js")).run()
 * Every sample is encoded in order (the look-ahead's board cache carries over as in Python) and compared with the
 * Python's features.encode output, then the network's logits with npmodel's. */
import { loadAI } from "./data.js";
import { encode } from "./features.js";
import { Network } from "./model.js";

function diff(a, b, path, out, tol) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      out.push(`${path}: 길이 ${Array.isArray(a) ? a.length : a} / ${Array.isArray(b) ? b.length : b}`);
      return;
    }
    a.forEach((x, i) => diff(x, b[i], `${path}[${i}]`, out, tol));
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of Object.keys(b)) diff(a[k], b[k], `${path}.${k}`, out, tol);
    return;
  }
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > tol) out.push(`${path}: JS ${a} / Python ${b}`);
    return;
  }
  if (a !== b) out.push(`${path}: JS ${a} / Python ${b}`);
}

export async function run({ limit = Infinity, logitTol = 2e-3, show = 8 } = {}) {
  const { db, model } = await loadAI();
  const net = new Network(model);
  const text = await (await fetch("data/ai/test/samples.jsonl", { cache: "reload" })).text();
  const samples = text.split("\n").filter(Boolean).slice(0, limit).map((l) => JSON.parse(l));
  let encBad = 0, logitBad = 0, worstLogit = 0, argmaxBad = 0;
  const reports = [];
  const t0 = performance.now();
  samples.forEach((s, i) => {
    const decision = { ...s.decision, options: s.decision.options.map((o) => ({ ...o })) };
    const enc = encode(s.view, decision, db);
    const out = [];
    diff(enc, s.enc, "enc", out, 1e-9);
    if (out.length) {
      encBad++;
      if (reports.length < show) reports.push(`#${i} (msg ${s.decision.msg}, 선택지 ${s.decision.options.length}): ${out.slice(0, 6).join(" | ")}`);
      return;
    }
    const { logits, value } = net.forward(enc);
    const real = s.logits.map((x, j) => [x, logits[j]]).filter(([x]) => x > -1e7);
    const err = Math.max(Math.abs(value - s.value), ...real.map(([x, y]) => Math.abs(x - y)));
    worstLogit = Math.max(worstLogit, err);
    if (err > logitTol) {
      logitBad++;
      if (reports.length < show) reports.push(`#${i} 출력 차이 ${err.toFixed(5)}`);
    }
    const am = (xs) => xs.indexOf(Math.max(...xs));
    if (am(logits) !== am(s.logits)) argmaxBad++;
  });
  const ms = performance.now() - t0;
  return { samples: samples.length, encodeMismatch: encBad, logitMismatch: logitBad, worstLogit, argmaxDiffers: argmaxBad,
    msPerDecision: +(ms / samples.length).toFixed(2), reports };
}
