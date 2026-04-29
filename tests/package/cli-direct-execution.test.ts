/**
 * Regression test for issue #76: under pnpm's default isolated layout,
 * `node_modules/.bin/flaker` (and `node_modules/<pkg>/dist/cli/main.js`)
 * are symlinks. The CLI's `isDirectCliExecution()` check used to compare
 * `resolve(process.argv[1])` against `fileURLToPath(import.meta.url)`, which
 * diverge when argv[1] is a symlink path. The CLI then exited 0 silently.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const builtMain = resolve(repoRoot, "dist/cli/main.js");

describe.skipIf(!existsSync(builtMain))("CLI entry under symlinks", () => {
  it("emits help when invoked through a symlinked path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "flaker-link-"));
    try {
      const link = join(tmp, "symlinked-main.js");
      symlinkSync(builtMain, link);

      const result = spawnSync(process.execPath, [link, "--help"], {
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: flaker");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
