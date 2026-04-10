import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Vitest global setup that ensures the /tmp/flaker-*.parquet fixture files
 * exist before the DuckDB↔mizchi/parquet interop test runs.
 *
 * These files are written by the MoonBit test
 * `src/parquet_export/write_fixture_test.mbt`, which is not triggered by
 * `pnpm test` on its own. Without this setup step a clean checkout would
 * fail `tests/parquet/duckdb-interop.test.ts`.
 */
export default async function setup(): Promise<void> {
  const fixtures = [
    "/tmp/flaker-test-results.parquet",
    "/tmp/flaker-commit-changes.parquet",
    "/tmp/flaker-workflow-runs.parquet",
  ];

  if (fixtures.every((p) => existsSync(p))) {
    return;
  }

  try {
    execSync("moon test -p mizchi/flaker/parquet_export", {
      stdio: "ignore",
      cwd: new URL("../..", import.meta.url),
    });
  } catch (err) {
    throw new Error(
      `Failed to generate parquet fixtures via 'moon test -p mizchi/flaker/parquet_export': ${String(err)}`,
    );
  }

  const missing = fixtures.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      `Parquet fixtures still missing after moon test: ${missing.join(", ")}`,
    );
  }
}
