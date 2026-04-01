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
    const flaky_rate = (g.fails / g.total) * 100;
    if (flaky_rate <= input.threshold) continue;
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
  const arr = [...meta];
  let s = seed >>> 0;

  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const r = lcg(s);
    s = r.next;
    const j = Math.floor(r.value * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.slice(0, count);
}

function sampleWeighted(meta: TestMeta[], count: number, seed: number): TestMeta[] {
  const remaining = [...meta];
  const result: TestMeta[] = [];
  let s = seed >>> 0;

  const n = Math.min(count, remaining.length);
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

// MoonBit JS backend types
interface MbtJsExports {
  detect_flaky_json: (input: string) => string;
  sample_random_json: (meta: string, count: number, seed: number) => string;
  sample_weighted_json: (meta: string, count: number, seed: number) => string;
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
  };
}

let cachedCore: MetriciCore | undefined;

export async function loadCore(): Promise<MetriciCore> {
  if (cachedCore) return cachedCore;
  try {
    const mbtPath = new URL(
      "../../../src/core/_build/js/debug/build/src/main/main.js",
      import.meta.url,
    ).href;
    const mbt = (await import(mbtPath)) as MbtJsExports;
    if (
      typeof mbt.detect_flaky_json === "function" &&
      typeof mbt.sample_random_json === "function" &&
      typeof mbt.sample_weighted_json === "function"
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
  };
  return cachedCore;
}

/** Synchronous fallback for contexts where async is not possible */
export function loadCoreSync(): MetriciCore {
  return {
    detectFlaky,
    sampleRandom,
    sampleWeighted,
  };
}
