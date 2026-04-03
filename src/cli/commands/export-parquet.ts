import { resolve, dirname } from "node:path";
import type { MetricStore } from "../storage/types.js";

export async function exportRunParquet(
  store: MetricStore,
  workflowRunId: number,
  storagePath: string,
): Promise<void> {
  const artifactsDir = resolve(dirname(storagePath), "artifacts");
  try {
    const result = await store.exportRunToParquet(workflowRunId, artifactsDir);
    console.log(
      `Exported to Parquet: ${result.testResultsCount} test results, ${result.commitChangesCount} commit changes`,
    );
  } catch (err) {
    // Non-fatal: log warning but don't fail the collect
    console.warn(`Warning: Parquet export failed: ${err instanceof Error ? err.message : err}`);
  }
}
