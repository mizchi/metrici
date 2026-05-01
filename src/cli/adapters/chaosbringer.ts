import type { TestCaseResult, TestResultAdapter } from "./types.js";
import { resolveTestIdentity } from "../identity.js";

/**
 * Adapter for chaosbringer's `CrawlReport` JSON.
 *
 * chaosbringer is mizchi's Playwright-based chaos crawler. Each run produces
 * a `CrawlReport` with per-page error attribution, network/console/exception
 * clusters, invariant violations, and (optional) coverage feedback. We map
 * those signals into flaker's `TestCaseResult` shape so the existing flaky
 * detector / quarantine policy / KPI pipeline can treat them like any other
 * test source.
 *
 * Mapping (v1):
 *
 *   1. Each visited `report.pages[i]` becomes one TestCaseResult.
 *      - suite      = `chaosbringer:pages`
 *      - testName   = the page's URL pathname (relative to `report.baseUrl`)
 *      - status     = "failed" when `page.status` is `error` / `timeout`,
 *                     or when `page.errors.length > 0`; "flaky" when
 *                     `page.status === "recovered"` (a real retry happened);
 *                     "passed" otherwise.
 *      - retryCount = 1 when the page was recovered, else 0.
 *      - errorMessage = a deduped, comma-joined preview of the unique
 *                       `error.message` strings on this page (capped at
 *                       4 messages × 200 chars to keep the storage row
 *                       reasonable).
 *
 *   2. Each `page.errors[j]` whose `type === "invariant-violation"` ALSO
 *      becomes its own TestCaseResult so flaker can track invariant
 *      stability over time:
 *      - suite      = `chaosbringer:invariants`
 *      - testName   = the invariant's `name` (chaosbringer guarantees one).
 *      - taskId     = the URL pathname so the same invariant on different
 *                     URLs is tracked as different tests.
 *      - status     = "failed" (invariant violations are always failures).
 *      - errorMessage = the violation message (already includes the
 *                       invariant name as `[name] reason`).
 *
 * The chaosbringer report is pure JSON with no external attachments to
 * collect; we leave `artifacts` / `failureLocation` null. `variant.seed`
 * carries the chaos seed so the run is identifiable in the storage row.
 *
 * What we deliberately don't emit: per-error-cluster rows for
 * console / network / exception clusters. Their fingerprints are
 * normalised (URLs / line:col / long ids stripped) but still drift across
 * chaosbringer versions, so using them as stable test identities ends up
 * fragile. Page-level rollups + per-invariant rows give flaker the
 * deterministic identities it needs without inheriting that fragility.
 */

interface ChaosbringerPageError {
  type: string;
  message: string;
  url?: string;
  invariantName?: string;
  timestamp?: number;
}

interface ChaosbringerPageResult {
  url: string;
  status: "success" | "error" | "timeout" | "recovered";
  loadTime: number;
  errors: ChaosbringerPageError[];
  hasErrors?: boolean;
}

interface ChaosbringerReport {
  baseUrl: string;
  seed: number;
  pages: ChaosbringerPageResult[];
}

const MAX_ERROR_MESSAGES_PER_PAGE = 4;
const MAX_ERROR_MESSAGE_CHARS = 200;

function relativePath(url: string, baseUrl: string): string {
  try {
    const u = new URL(url);
    const base = new URL(baseUrl);
    if (u.origin !== base.origin) {
      // Different origin → keep the full URL so it's traceable.
      return url;
    }
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

function summarizeErrorMessages(errors: ReadonlyArray<ChaosbringerPageError>): string | undefined {
  if (errors.length === 0) return undefined;
  const seen = new Set<string>();
  const picked: string[] = [];
  let droppedUnique = 0;
  for (const error of errors) {
    const message = (error.message ?? "").trim();
    if (message.length === 0 || seen.has(message)) continue;
    seen.add(message);
    if (picked.length >= MAX_ERROR_MESSAGES_PER_PAGE) {
      droppedUnique++;
      continue;
    }
    picked.push(
      message.length > MAX_ERROR_MESSAGE_CHARS
        ? `${message.slice(0, MAX_ERROR_MESSAGE_CHARS)}…`
        : message,
    );
  }
  if (picked.length === 0) return undefined;
  // Suffix counts UNIQUE messages we had to drop, not duplicates we deduped —
  // otherwise a noisy log line would inflate the count and mislead the reader.
  const suffix = droppedUnique > 0 ? ` (+${droppedUnique} more)` : "";
  return picked.join(" | ") + suffix;
}

function statusOf(page: ChaosbringerPageResult): TestCaseResult["status"] {
  if (page.status === "recovered") return "flaky";
  if (page.status === "error" || page.status === "timeout") return "failed";
  if (page.errors.length > 0) return "failed";
  return "passed";
}

function pageResult(
  page: ChaosbringerPageResult,
  baseUrl: string,
  seed: number,
): TestCaseResult {
  const status = statusOf(page);
  const result: TestCaseResult = resolveTestIdentity({
    suite: "chaosbringer:pages",
    testName: relativePath(page.url, baseUrl),
    taskId: "chaosbringer:pages",
    status,
    durationMs: typeof page.loadTime === "number" ? page.loadTime : 0,
    retryCount: page.status === "recovered" ? 1 : 0,
    variant: { source: "chaosbringer", seed: String(seed) },
  });
  const errorMessage = summarizeErrorMessages(page.errors);
  if (errorMessage !== undefined) {
    result.errorMessage = errorMessage;
  }
  return result;
}

function invariantViolationResults(
  page: ChaosbringerPageResult,
  baseUrl: string,
  seed: number,
): TestCaseResult[] {
  const path = relativePath(page.url, baseUrl);
  const out: TestCaseResult[] = [];
  for (const error of page.errors) {
    if (error.type !== "invariant-violation") continue;
    const name = error.invariantName ?? "unknown-invariant";
    const result: TestCaseResult = resolveTestIdentity({
      suite: "chaosbringer:invariants",
      testName: name,
      taskId: path,
      status: "failed",
      durationMs: 0,
      retryCount: 0,
      variant: { source: "chaosbringer", seed: String(seed), url: path },
    });
    if (error.message) {
      result.errorMessage = error.message;
    }
    out.push(result);
  }
  return out;
}

export const chaosbringerAdapter: TestResultAdapter = {
  name: "chaosbringer",
  parse(input: string): TestCaseResult[] {
    const report = JSON.parse(input) as ChaosbringerReport;
    if (!Array.isArray(report?.pages)) return [];
    const baseUrl = typeof report.baseUrl === "string" ? report.baseUrl : "";
    const seed = typeof report.seed === "number" ? report.seed : 0;
    const out: TestCaseResult[] = [];
    for (const page of report.pages) {
      out.push(pageResult(page, baseUrl, seed));
      out.push(...invariantViolationResults(page, baseUrl, seed));
    }
    return out;
  },
};
