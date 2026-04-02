export interface DetectInput {
  results: Array<{
    suite: string;
    test_name: string;
    status: string;
    retry_count: number;
  }>;
  threshold: number;
  min_runs: number;
}

export interface FlakyResult {
  suite: string;
  test_name: string;
  flaky_rate: number;
  total_runs: number;
  fail_count: number;
  flaky_retry_count: number;
  is_quarantined: boolean;
}

export interface DetectOutput {
  flaky_tests: FlakyResult[];
}

export interface TestMeta {
  suite: string;
  test_name: string;
  flaky_rate: number;
  total_runs: number;
  fail_count: number;
  last_run_at: string;
  avg_duration_ms: number;
  previously_failed: boolean;
  is_new: boolean;
}

export interface MetriciCore {
  detectFlaky(input: DetectInput): DetectOutput;
  sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[];
  sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[];
  sampleHybrid(meta: TestMeta[], affectedSuites: string[], count: number, seed: number): TestMeta[];
  resolveAffected(workflowText: string, changedPaths: string[]): string[];
}

/** LCG PRNG: returns next state and a float in [0, 1) */
function lcg(seed: number): { next: number; value: number } {
  // LCG parameters (Numerical Recipes)
  const next = (seed * 1664525 + 1013904223) >>> 0;
  const value = next / 0x100000000;
  return { next, value };
}

function detectFlaky(input: DetectInput): DetectOutput {
  const groups = new Map<
    string,
    { suite: string; test_name: string; total: number; fails: number; flaky_retries: number }
  >();

  for (const r of input.results) {
    const key = `${r.suite}\0${r.test_name}`;
    let g = groups.get(key);
    if (!g) {
      g = { suite: r.suite, test_name: r.test_name, total: 0, fails: 0, flaky_retries: 0 };
      groups.set(key, g);
    }
    g.total++;
    if (r.status === "failed") {
      g.fails++;
    }
    if (r.retry_count > 0 && r.status === "passed") {
      g.flaky_retries++;
    }
  }

  const flaky_tests: FlakyResult[] = [];
  for (const g of groups.values()) {
    if (g.total < input.min_runs) continue;
    const flaky_rate = ((g.fails + g.flaky_retries) / g.total) * 100;
    if (flaky_rate < input.threshold) continue;
    flaky_tests.push({
      suite: g.suite,
      test_name: g.test_name,
      flaky_rate,
      total_runs: g.total,
      fail_count: g.fails,
      flaky_retry_count: g.flaky_retries,
      is_quarantined: false,
    });
  }

  flaky_tests.sort((a, b) => b.flaky_rate - a.flaky_rate);
  return { flaky_tests };
}

function sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[] {
  const actualCount = clampSampleCount(count, meta.length);
  if (actualCount === 0) {
    return [];
  }
  const arr = [...meta];
  let s = seed >>> 0;

  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const r = lcg(s);
    s = r.next;
    const j = Math.floor(r.value * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.slice(0, actualCount);
}

function sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[] {
  const actualCount = clampSampleCount(count, meta.length);
  if (actualCount === 0) {
    return [];
  }
  const remaining = [...meta];
  const result: TestMeta[] = [];
  let s = seed >>> 0;

  const n = actualCount;
  for (let picked = 0; picked < n; picked++) {
    // Compute weights
    const weights = remaining.map((m) => 1.0 + m.flaky_rate);
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const r = lcg(s);
    s = r.next;
    const target = r.value * totalWeight;

    let cumulative = 0;
    let idx = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (cumulative > target) {
        idx = i;
        break;
      }
    }

    result.push(remaining[idx]);
    remaining.splice(idx, 1);
  }

  return result;
}

function sampleHybrid(meta: TestMeta[], affectedSuites: string[], count: number, seed: number): TestMeta[] {
  const actualCount = clampSampleCount(count, meta.length);
  if (actualCount === 0) {
    return [];
  }
  const affectedSet = new Set(affectedSuites);
  const selected: TestMeta[] = [];
  const used = new Set<number>();

  // Priority 1: affected
  meta.forEach((m, i) => { if (affectedSet.has(m.suite) && !used.has(i)) { selected.push(m); used.add(i); } });
  // Priority 2: previously failed
  meta.forEach((m, i) => { if (m.previously_failed && !used.has(i)) { selected.push(m); used.add(i); } });
  // Priority 3: new
  meta.forEach((m, i) => { if (m.is_new && !used.has(i)) { selected.push(m); used.add(i); } });
  // Priority 4: weighted random for remaining
  if (selected.length < actualCount) {
    const remaining = meta.filter((_, i) => !used.has(i));
    const extra = sampleWeighted(remaining, actualCount - selected.length, seed);
    selected.push(...extra);
  }
  return selected.slice(0, actualCount);
}

function clampSampleCount(count: number, total: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.trunc(count), total));
}

// MoonBit JS backend types
interface MbtJsExports {
  detect_flaky_json: (input: string) => string;
  sample_random_json: (meta: string, count: number, seed: number) => string;
  sample_weighted_json: (meta: string, count: number, seed: number) => string;
  sample_hybrid_json: (meta: string, affected: string, count: number, seed: number) => string;
  resolve_affected_json: (workflow: string, changed: string) => string;
}

function wrapMbtCore(mbt: MbtJsExports): MetriciCore {
  return {
    detectFlaky(input: DetectInput): DetectOutput {
      return JSON.parse(mbt.detect_flaky_json(JSON.stringify(input)));
    },
    sampleRandom(meta: TestMeta[], count: number, seed: number): TestMeta[] {
      return JSON.parse(mbt.sample_random_json(JSON.stringify(meta), count, seed));
    },
    sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[] {
      return JSON.parse(mbt.sample_weighted_json(JSON.stringify(meta), count, seed));
    },
    sampleHybrid(meta: TestMeta[], affectedSuites: string[], count: number, seed: number): TestMeta[] {
      return JSON.parse(mbt.sample_hybrid_json(JSON.stringify(meta), JSON.stringify(affectedSuites), count, seed));
    },
    resolveAffected(workflowText: string, changedPaths: string[]): string[] {
      return JSON.parse(mbt.resolve_affected_json(workflowText, JSON.stringify(changedPaths)));
    },
  };
}

let cachedCore: MetriciCore | undefined;
const MOONBIT_JS_BUILD_URL = new URL(
  "../../../src/core/_build/js/debug/build/src/main/main.js",
  import.meta.url,
);

export async function loadCore(): Promise<MetriciCore> {
  if (cachedCore) return cachedCore;
  try {
    const mbtPath = MOONBIT_JS_BUILD_URL.href;
    const mbt = (await import(mbtPath)) as MbtJsExports;
    if (
      typeof mbt.detect_flaky_json === "function" &&
      typeof mbt.sample_random_json === "function" &&
      typeof mbt.sample_weighted_json === "function" &&
      typeof mbt.sample_hybrid_json === "function" &&
      typeof mbt.resolve_affected_json === "function"
    ) {
      cachedCore = wrapMbtCore(mbt);
      return cachedCore;
    }
  } catch {
    // MoonBit JS build not available, fall back to TS implementation
  }
  cachedCore = {
    detectFlaky,
    sampleRandom,
    sampleWeighted,
    sampleHybrid,
    resolveAffected: resolveAffectedFallback,
  };
  return cachedCore;
}

export async function hasMoonBitJsBuild(): Promise<boolean> {
  try {
    await access(MOONBIT_JS_BUILD_URL);
    return true;
  } catch {
    return false;
  }
}

/** Synchronous fallback for contexts where async is not possible */
export function loadCoreSync(): MetriciCore {
  return {
    detectFlaky,
    sampleRandom,
    sampleWeighted,
    sampleHybrid,
    resolveAffected: resolveAffectedFallback,
  };
}

interface FallbackTask {
  id: string;
  needs: string[];
  srcs: string[];
}

/** TS fallback for affected-target resolution when MoonBit build is unavailable. */
function resolveAffectedFallback(workflowText: string, changedPaths: string[]): string[] {
  const tasks = parseWorkflowTasks(workflowText);
  if (tasks.length === 0 || changedPaths.length === 0) return [];

  const initial = new Set<string>();
  for (const task of tasks) {
    if (task.srcs.length === 0) continue;
    const matched = changedPaths.some((path) => task.srcs.some((pattern) => matchGlob(pattern, path)));
    if (matched) {
      initial.add(task.id);
    }
  }
  if (initial.size === 0) return [];

  const byNeed = new Map<string, string[]>();
  for (const task of tasks) {
    for (const need of task.needs) {
      const dependents = byNeed.get(need);
      if (dependents) dependents.push(task.id);
      else byNeed.set(need, [task.id]);
    }
  }

  // Expand transitive dependents (A needed by B => A change affects B)
  const affected = new Set(initial);
  const queue = [...initial];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const dependent of byNeed.get(current) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...affected];
}

function parseWorkflowTasks(workflowText: string): FallbackTask[] {
  const blocks = extractTaskBlocks(workflowText);
  const tasks: FallbackTask[] = [];
  for (const block of blocks) {
    const id = getQuotedValue(block, "id");
    if (!id) continue;

    tasks.push({
      id,
      needs: getQuotedArrayValue(block, "needs"),
      srcs: getQuotedArrayValue(block, "srcs"),
    });
  }
  return tasks;
}

function extractTaskBlocks(workflowText: string): string[] {
  const blocks: string[] = [];
  let i = 0;
  while (i < workflowText.length) {
    const idx = workflowText.indexOf("task(", i);
    if (idx === -1) break;

    let depth = 0;
    let inString = false;
    let end = idx;
    for (; end < workflowText.length; end++) {
      const ch = workflowText[end];
      const prev = end > 0 ? workflowText[end - 1] : "";

      if (ch === "\"" && prev !== "\\") {
        inString = !inString;
      }
      if (inString) continue;

      if (ch === "(") depth++;
      if (ch === ")") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    if (end > idx) {
      blocks.push(workflowText.slice(idx, end));
      i = end;
    } else {
      i = idx + 5;
    }
  }
  return blocks;
}

function getQuotedValue(line: string, key: string): string | null {
  const m = new RegExp(`${key}\\s*=\\s*(['"])(.*?)\\1`, "s").exec(line);
  return m?.[2] ?? null;
}

function getQuotedArrayValue(line: string, key: string): string[] {
  const m = new RegExp(`${key}\\s*=\\s*\\[(.*?)\\]`, "s").exec(line);
  if (!m) return [];
  const inner = m[1].trim();
  if (!inner) return [];
  const values: string[] = [];
  const re = /(['"])(.*?)\1/g;
  for (const match of inner.matchAll(re)) {
    values.push(match[2]);
  }
  return values;
}

function matchGlob(pattern: string, target: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const normalizedTarget = target.replaceAll("\\", "/");
  const regex = globToRegex(normalizedPattern);
  return regex.test(normalizedTarget);
}

function globToRegex(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (".+?^${}()|[]\\".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  out += "$";
  return new RegExp(out);
}
import { access } from "node:fs/promises";
