import { describe, it, expect, vi } from "vitest";
import { BitflowResolver } from "../../src/cli/resolvers/bitflow.js";

describe("BitflowResolver", () => {
  it("calls bitflow CLI and parses output", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: "tests/auth/login.spec.ts\ntests/auth/register.spec.ts\n",
      stderr: "",
    });
    const resolver = new BitflowResolver("bitflow.toml", exec);
    const changed = ["src/auth/login.ts"];
    const allTests = [
      "tests/auth/login.spec.ts",
      "tests/auth/register.spec.ts",
    ];
    const result = await resolver.resolve(changed, allTests);

    expect(exec).toHaveBeenCalledWith(
      "bitflow affected --config bitflow.toml --changed src/auth/login.ts",
    );
    expect(result).toEqual([
      "tests/auth/login.spec.ts",
      "tests/auth/register.spec.ts",
    ]);
  });

  it("returns empty when bitflow returns empty", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
    });
    const resolver = new BitflowResolver("bitflow.toml", exec);
    const result = await resolver.resolve(["src/foo.ts"], ["tests/foo.spec.ts"]);

    expect(result).toEqual([]);
  });

  it("filters output against known test files", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: "tests/auth/login.spec.ts\ntests/unknown/file.spec.ts\n",
      stderr: "",
    });
    const resolver = new BitflowResolver("bitflow.toml", exec);
    const allTests = ["tests/auth/login.spec.ts"];
    const result = await resolver.resolve(["src/auth/login.ts"], allTests);

    expect(result).toEqual(["tests/auth/login.spec.ts"]);
  });
});
