import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { playwrightAdapter } from "../../src/cli/adapters/playwright.js";

const fixtureJson = readFileSync(
  join(import.meta.dirname, "../fixtures/playwright-report.json"),
  "utf-8",
);

describe("playwrightAdapter", () => {
  it('has name "playwright"', () => {
    expect(playwrightAdapter.name).toBe("playwright");
  });

  it("returns all 4 test results", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    expect(results).toHaveLength(4);
  });

  it("parses passing test", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const passed = results.find((r) => r.testName === "should display form");
    expect(passed).toEqual({
      suite: "login page",
      testName: "should display form",
      status: "passed",
      durationMs: 1200,
      retryCount: 0,
      variant: { project: "chromium" },
    });
  });

  it("parses flaky test (retry passed)", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const flaky = results.find(
      (r) => r.testName === "should redirect after login",
    );
    expect(flaky).toEqual({
      suite: "login page",
      testName: "should redirect after login",
      status: "flaky",
      durationMs: 1500,
      retryCount: 1,
      errorMessage: "Timeout",
      variant: { project: "chromium" },
    });
  });

  it("parses failed test", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const failed = results.find(
      (r) => r.testName === "should show error on invalid credentials",
    );
    expect(failed).toEqual({
      suite: "login page",
      testName: "should show error on invalid credentials",
      status: "failed",
      durationMs: 2000,
      retryCount: 0,
      errorMessage: "Element not found",
      variant: { project: "chromium" },
    });
  });

  it("parses skipped test", () => {
    const results = playwrightAdapter.parse(fixtureJson);
    const skipped = results.find(
      (r) => r.testName === "should skip on mobile",
    );
    expect(skipped).toEqual({
      suite: "login page",
      testName: "should skip on mobile",
      status: "skipped",
      durationMs: 0,
      retryCount: 0,
      variant: { project: "chromium" },
    });
  });
});
