import { describe, it, expect } from "vitest";
import { cargoTestAdapter } from "../../src/cli/adapters/cargo.js";

describe("cargoTestAdapter", () => {
  it("parses cargo test text output", () => {
    const input = [
      "running 3 tests",
      "test math::test_add ... ok",
      "test math::test_sub ... FAILED",
      "test math::test_mul ... ok",
      "",
      "failures:",
      "",
      "---- math::test_sub stdout ----",
      "thread 'math::test_sub' panicked at 'assertion failed: expected 5 got 3'",
      "",
      "failures:",
      "    math::test_sub",
      "",
      "test result: FAILED. 2 passed; 1 failed; 0 ignored",
    ].join("\n");

    const results = cargoTestAdapter.parse(input);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({
      suite: "math",
      testName: "test_add",
      status: "passed",
    });
    expect(results[1]).toMatchObject({
      suite: "math",
      testName: "test_sub",
      status: "failed",
    });
    expect(results[1].errorMessage).toContain("assertion failed");
    expect(results[2]).toMatchObject({
      suite: "math",
      testName: "test_mul",
      status: "passed",
    });
  });

  it("skips ignored tests", () => {
    const input = [
      "running 2 tests",
      "test slow::test_slow ... ignored",
      "test fast::test_fast ... ok",
    ].join("\n");

    const results = cargoTestAdapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("test_fast");
  });

  it("handles deeply nested modules", () => {
    const input = "test crate::module::sub::test_deep ... ok\n";
    const results = cargoTestAdapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].suite).toBe("crate::module::sub");
    expect(results[0].testName).toBe("test_deep");
  });

  it("parses cargo test JSON format", () => {
    const input = [
      '{"type":"suite","event":"started","test_count":2}',
      '{"type":"test","event":"ok","name":"math::test_add","exec_time":0.001}',
      '{"type":"test","event":"failed","name":"math::test_sub","exec_time":0.002,"stdout":"assertion failed"}',
      '{"type":"suite","event":"failed","passed":1,"failed":1}',
    ].join("\n");

    const results = cargoTestAdapter.parse(input);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      suite: "math",
      testName: "test_add",
      status: "passed",
      durationMs: 1,
    });
    expect(results[1]).toMatchObject({
      suite: "math",
      testName: "test_sub",
      status: "failed",
      durationMs: 2,
    });
  });

  it("handles empty input", () => {
    expect(cargoTestAdapter.parse("")).toHaveLength(0);
  });
});
