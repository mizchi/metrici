import { describe, it, expect } from "vitest";
import { gotestAdapter } from "../../src/cli/adapters/gotest.js";

describe("gotestAdapter", () => {
  it("parses go test -json NDJSON output", () => {
    const input = [
      '{"Action":"run","Package":"example.com/pkg","Test":"TestAdd"}',
      '{"Action":"output","Package":"example.com/pkg","Test":"TestAdd","Output":"=== RUN   TestAdd\\n"}',
      '{"Action":"pass","Package":"example.com/pkg","Test":"TestAdd","Elapsed":0.01}',
      '{"Action":"run","Package":"example.com/pkg","Test":"TestSubtract"}',
      '{"Action":"output","Package":"example.com/pkg","Test":"TestSubtract","Output":"--- FAIL: TestSubtract (0.02s)\\n"}',
      '{"Action":"output","Package":"example.com/pkg","Test":"TestSubtract","Output":"    expected 5 got 3\\n"}',
      '{"Action":"fail","Package":"example.com/pkg","Test":"TestSubtract","Elapsed":0.02}',
      '{"Action":"pass","Package":"example.com/pkg","Elapsed":0.03}',
    ].join("\n");

    const results = gotestAdapter.parse(input);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      suite: "example.com/pkg",
      testName: "TestAdd",
      status: "passed",
      durationMs: 10,
    });
    expect(results[1]).toMatchObject({
      suite: "example.com/pkg",
      testName: "TestSubtract",
      status: "failed",
      durationMs: 20,
    });
    expect(results[1].errorMessage).toContain("expected 5 got 3");
  });

  it("skips package-level events and skip actions", () => {
    const input = [
      '{"Action":"pass","Package":"example.com/pkg","Elapsed":1}',
      '{"Action":"skip","Package":"example.com/pkg","Test":"TestSkipped","Elapsed":0}',
      '{"Action":"pass","Package":"example.com/pkg","Test":"TestOnly","Elapsed":0.1}',
    ].join("\n");

    const results = gotestAdapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("TestOnly");
  });

  it("handles subtests", () => {
    const input = [
      '{"Action":"run","Package":"example.com/pkg","Test":"TestTable"}',
      '{"Action":"run","Package":"example.com/pkg","Test":"TestTable/case_1"}',
      '{"Action":"pass","Package":"example.com/pkg","Test":"TestTable/case_1","Elapsed":0.01}',
      '{"Action":"run","Package":"example.com/pkg","Test":"TestTable/case_2"}',
      '{"Action":"fail","Package":"example.com/pkg","Test":"TestTable/case_2","Elapsed":0.02}',
      '{"Action":"fail","Package":"example.com/pkg","Test":"TestTable","Elapsed":0.03}',
    ].join("\n");

    const results = gotestAdapter.parse(input);
    expect(results).toHaveLength(3);
    expect(results[0].testName).toBe("TestTable/case_1");
    expect(results[0].status).toBe("passed");
    expect(results[1].testName).toBe("TestTable/case_2");
    expect(results[1].status).toBe("failed");
  });

  it("handles empty input", () => {
    expect(gotestAdapter.parse("")).toHaveLength(0);
  });
});
