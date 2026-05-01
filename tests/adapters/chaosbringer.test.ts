import { describe, expect, it } from "vitest";
import { chaosbringerAdapter } from "../../src/cli/adapters/chaosbringer.js";

const SAMPLE = JSON.stringify({
  baseUrl: "http://127.0.0.1:4173",
  seed: 42,
  pages: [
    {
      url: "http://127.0.0.1:4173/",
      status: "success",
      loadTime: 320,
      errors: [],
    },
    {
      url: "http://127.0.0.1:4173/dashboard",
      status: "success",
      loadTime: 410,
      errors: [
        { type: "console", message: "Failed to load resource: status 500" },
        { type: "network", message: "/api/x - net::ERR_ABORTED" },
        { type: "console", message: "Failed to load resource: status 500" }, // dup
      ],
    },
    {
      url: "http://127.0.0.1:4173/diagnose",
      status: "recovered",
      loadTime: 1500,
      errors: [
        { type: "console", message: "HTTP 503" },
      ],
    },
    {
      url: "http://127.0.0.1:4173/ops",
      status: "timeout",
      loadTime: 30000,
      errors: [],
    },
    {
      url: "http://127.0.0.1:4173/cart",
      status: "success",
      loadTime: 200,
      errors: [
        {
          type: "invariant-violation",
          message: "[cart-monotonic] cart count went from 3 to 1",
          invariantName: "cart-monotonic",
        },
        {
          type: "invariant-violation",
          message: "[has-h1] no <h1>",
          invariantName: "has-h1",
        },
      ],
    },
  ],
});

describe("chaosbringerAdapter.parse", () => {
  it("emits one TestCaseResult per page plus one per invariant violation", () => {
    const results = chaosbringerAdapter.parse(SAMPLE);
    // 5 pages + 2 invariant violations on /cart = 7
    expect(results).toHaveLength(7);
  });

  it("uses chaosbringer:pages as the suite for page-level rows", () => {
    const results = chaosbringerAdapter.parse(SAMPLE);
    const pageRows = results.filter((r) => r.suite === "chaosbringer:pages");
    expect(pageRows.map((r) => r.testName)).toEqual([
      "/",
      "/dashboard",
      "/diagnose",
      "/ops",
      "/cart",
    ]);
  });

  it("maps page.status correctly to passed / failed / flaky", () => {
    const results = chaosbringerAdapter.parse(SAMPLE);
    const pages = new Map(
      results
        .filter((r) => r.suite === "chaosbringer:pages")
        .map((r) => [r.testName, r] as const),
    );
    expect(pages.get("/")?.status).toBe("passed");
    expect(pages.get("/dashboard")?.status).toBe("failed"); // has errors
    expect(pages.get("/diagnose")?.status).toBe("flaky"); // recovered
    expect(pages.get("/ops")?.status).toBe("failed"); // timeout
    expect(pages.get("/cart")?.status).toBe("failed"); // invariant violations are errors too
  });

  it("retryCount is 1 for recovered pages, 0 otherwise", () => {
    const results = chaosbringerAdapter.parse(SAMPLE);
    const pages = new Map(
      results
        .filter((r) => r.suite === "chaosbringer:pages")
        .map((r) => [r.testName, r] as const),
    );
    expect(pages.get("/diagnose")?.retryCount).toBe(1);
    expect(pages.get("/")?.retryCount).toBe(0);
    expect(pages.get("/dashboard")?.retryCount).toBe(0);
  });

  it("dedupes errorMessage and joins with ' | '", () => {
    const results = chaosbringerAdapter.parse(SAMPLE);
    const dashboard = results.find(
      (r) => r.suite === "chaosbringer:pages" && r.testName === "/dashboard",
    );
    expect(dashboard?.errorMessage).toBe(
      "Failed to load resource: status 500 | /api/x - net::ERR_ABORTED",
    );
  });

  it("emits one chaosbringer:invariants row per violation, keyed by invariant name + URL", () => {
    const results = chaosbringerAdapter.parse(SAMPLE);
    const inv = results.filter((r) => r.suite === "chaosbringer:invariants");
    expect(inv).toHaveLength(2);
    const cartMonotonic = inv.find((r) => r.testName === "cart-monotonic");
    expect(cartMonotonic).toBeDefined();
    expect(cartMonotonic?.status).toBe("failed");
    expect(cartMonotonic?.taskId).toBe("/cart");
    expect(cartMonotonic?.errorMessage).toBe("[cart-monotonic] cart count went from 3 to 1");
    expect(cartMonotonic?.variant).toMatchObject({ source: "chaosbringer", url: "/cart" });
  });

  it("carries the chaos seed in variant so storage rows are identifiable per run", () => {
    const results = chaosbringerAdapter.parse(SAMPLE);
    for (const r of results) {
      expect(r.variant).toMatchObject({ source: "chaosbringer", seed: "42" });
    }
  });

  it("returns [] on a report with no pages", () => {
    expect(chaosbringerAdapter.parse(JSON.stringify({ baseUrl: "x", seed: 1, pages: [] }))).toEqual(
      [],
    );
  });

  it("keeps the full URL when the page is on a different origin from baseUrl", () => {
    const report = JSON.stringify({
      baseUrl: "http://127.0.0.1:4173",
      seed: 1,
      pages: [{ url: "https://external.example.com/foo", status: "success", loadTime: 100, errors: [] }],
    });
    const [row] = chaosbringerAdapter.parse(report);
    expect(row.testName).toBe("https://external.example.com/foo");
  });
});
