export interface TimeBudgetResult<T> {
  selected: T[];
  skippedCount: number;
  skippedDurationMs: number;
}

interface TimeBudgetTest {
  avg_duration_ms: number;
  flaky_rate: number;
  co_failure_boost: number;
}

function testPriority(t: TimeBudgetTest): number {
  return t.flaky_rate + t.co_failure_boost;
}

export function applyTimeBudget<T extends TimeBudgetTest>(
  tests: T[],
  maxDurationSeconds: number,
): TimeBudgetResult<T> {
  const budgetMs = maxDurationSeconds * 1000;
  const totalMs = tests.reduce((sum, t) => sum + t.avg_duration_ms, 0);

  if (totalMs <= budgetMs) {
    return { selected: tests, skippedCount: 0, skippedDurationMs: 0 };
  }

  const sorted = [...tests].sort((a, b) => testPriority(b) - testPriority(a));
  const selected: T[] = [];
  let accMs = 0;

  for (const t of sorted) {
    if (accMs + t.avg_duration_ms > budgetMs && selected.length > 0) {
      continue;
    }
    selected.push(t);
    accMs += t.avg_duration_ms;
  }

  return {
    selected,
    skippedCount: tests.length - selected.length,
    skippedDurationMs: totalMs - accMs,
  };
}
