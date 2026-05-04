import { describe, it, expect } from "vitest";
import { parseTagOption, validateTagKey, WorkflowFilterError } from "../src/cli/workflow-filter.js";

describe("workflow-filter helpers (#74)", () => {
  describe("validateTagKey", () => {
    it("accepts alphanumeric and the safe punctuation set", () => {
      expect(() => validateTagKey("suite")).not.toThrow();
      expect(() => validateTagKey("a-b_c.d/e")).not.toThrow();
      expect(() => validateTagKey("Owner123")).not.toThrow();
    });

    it("rejects keys containing SQL-significant characters", () => {
      expect(() => validateTagKey("foo'bar")).toThrow(WorkflowFilterError);
      expect(() => validateTagKey("foo bar")).toThrow(WorkflowFilterError);
      expect(() => validateTagKey("foo;DROP")).toThrow(WorkflowFilterError);
      expect(() => validateTagKey("")).toThrow(WorkflowFilterError);
    });
  });

  describe("parseTagOption", () => {
    it("returns undefined for missing or empty input", () => {
      expect(parseTagOption(undefined)).toBeUndefined();
      expect(parseTagOption([])).toBeUndefined();
    });

    it("parses k=v pairs into a record", () => {
      expect(parseTagOption(["suite=cms"])).toEqual({ suite: "cms" });
      expect(parseTagOption(["suite=cms", "owner=platform"])).toEqual({
        suite: "cms",
        owner: "platform",
      });
    });

    it("preserves '=' inside the value", () => {
      expect(parseTagOption(["jwt=a=b=c"])).toEqual({ jwt: "a=b=c" });
    });

    it("rejects malformed entries", () => {
      expect(() => parseTagOption(["nokey"])).toThrow(WorkflowFilterError);
      expect(() => parseTagOption(["=value"])).toThrow(WorkflowFilterError);
    });

    it("rejects keys with unsupported characters", () => {
      expect(() => parseTagOption(["foo bar=ok"])).toThrow(WorkflowFilterError);
      expect(() => parseTagOption(["foo'=ok"])).toThrow(WorkflowFilterError);
    });
  });
});
