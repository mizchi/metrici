import { describe, it, expect } from "vitest";
import { tapAdapter } from "../../src/cli/adapters/tap.js";

describe("tapAdapter", () => {
  it("parses git test TAP output with suite delimiters", () => {
    const input = [
      "*** t0000-basic.sh ***",
      "ok 1 - verify that the running shell supports local",
      "ok 2 - .git/objects should be empty after git init",
      "not ok 3 - this test fails",
      "*** t0001-init.sh ***",
      "ok 1 - plain init",
      "ok 2 # skip test_oid for SHA-256 (missing BIT_SHA256)",
      "not ok 3 - init with --bare fails",
    ].join("\n");

    const results = tapAdapter.parse(input);

    // Skipped tests are excluded
    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({
      suite: "t0000-basic.sh",
      testName: "verify that the running shell supports local",
      status: "passed",
    });
    expect(results[2]).toMatchObject({
      suite: "t0000-basic.sh",
      testName: "this test fails",
      status: "failed",
    });
    expect(results[3]).toMatchObject({
      suite: "t0001-init.sh",
      testName: "plain init",
      status: "passed",
    });
    expect(results[4]).toMatchObject({
      suite: "t0001-init.sh",
      testName: "init with --bare fails",
      status: "failed",
    });
  });

  it("skips TODO known failures", () => {
    const input = [
      "*** t0000-basic.sh ***",
      "not ok 1 - known broken test # TODO known breakage",
      "ok 2 - passing test",
    ].join("\n");

    const results = tapAdapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("passing test");
  });

  it("handles empty input", () => {
    expect(tapAdapter.parse("")).toHaveLength(0);
  });

  it("parses real git test log excerpt", () => {
    const input = [
      "*** t5300-pack-object.sh ***",
      "ok 1 - setup",
      "not ok 2 - pack-objects with index version 1",
      "not ok 3 - pack-objects with index version 2",
      "not ok 4 - both packs should be identical",
      "ok 5 - unpack-objects with strict mode",
      "*** t5301-sliding-window.sh ***",
      "ok 1 - setup",
      "ok 2 - verify-pack -v",
    ].join("\n");

    const results = tapAdapter.parse(input);
    expect(results).toHaveLength(7);

    const failures = results.filter((r) => r.status === "failed");
    expect(failures).toHaveLength(3);
    expect(failures[0].suite).toBe("t5300-pack-object.sh");

    const t5301 = results.filter((r) => r.suite === "t5301-sliding-window.sh");
    expect(t5301).toHaveLength(2);
    expect(t5301.every((r) => r.status === "passed")).toBe(true);
  });
});
