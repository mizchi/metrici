import { describe, it, expect } from "vitest";
import { loadCoreSync } from "../../src/cli/core/loader.js";

describe("resolveAffectedFallback glob parity", () => {
  const core = loadCoreSync();

  it("treats * as single path segment", () => {
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/*/index.ts"])',
    ].join("\n");

    expect(core.resolveAffected(workflow, ["src/auth/index.ts"])).toContain("test-auth");
    expect(core.resolveAffected(workflow, ["src/auth/ui/index.ts"])).toEqual([]);
  });

  it("treats ** as multi-segment wildcard", () => {
    const workflow = [
      'workflow(name="ci")',
      'node(id="auth", depends_on=[])',
      'task(id="test-auth", node="auth", cmd="test", needs=[], srcs=["src/**/index.ts"])',
    ].join("\n");

    expect(core.resolveAffected(workflow, ["src/auth/index.ts"])).toContain("test-auth");
    expect(core.resolveAffected(workflow, ["src/auth/ui/index.ts"])).toContain("test-auth");
  });

  it("supports mixed quote style in src arrays", () => {
    const workflow = [
      "workflow(name='ci')",
      "node(id='auth', depends_on=[])",
      "task(id='test-auth', node='auth', cmd='test', needs=[], srcs=['src/auth/**', \"src/shared/**\"])",
    ].join("\n");

    expect(core.resolveAffected(workflow, ["src/shared/util.ts"])).toContain("test-auth");
  });
});
