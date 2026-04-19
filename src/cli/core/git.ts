import { execSync, spawnSync } from "node:child_process";
import type { CommitChange } from "../storage/types.js";

const CHANGE_TYPE_MAP: Record<string, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  C: "copied",
};

export function parseGitDiffTree(output: string): CommitChange[] {
  const results: CommitChange[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = parts[0];
    if (status.startsWith("R") || status.startsWith("C")) {
      results.push({
        filePath: parts[2] ?? parts[1],
        changeType: status.startsWith("R") ? "renamed" : "copied",
        additions: 0,
        deletions: 0,
      });
    } else {
      results.push({
        filePath: parts[1],
        changeType: CHANGE_TYPE_MAP[status] ?? status.toLowerCase(),
        additions: 0,
        deletions: 0,
      });
    }
  }
  return results;
}

export function resolveCommitChanges(cwd: string, commitSha: string): CommitChange[] | null {
  try {
    const result = spawnSync(
      "git",
      ["diff-tree", "-m", "--first-parent", "--no-commit-id", "--name-status", "-r", commitSha],
      { cwd, stdio: ["ignore", "pipe", "ignore"] },
    );
    if (result.status !== 0) return null;
    return parseGitDiffTree(result.stdout.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Auto-detect changed files relative to the default branch (main/master)
 * or HEAD~1 if already on the default branch.
 */
export function detectChangedFiles(cwd: string): string[] {
  try {
    // Try comparing against main/master
    for (const base of ["origin/main", "origin/master", "main", "master"]) {
      const mergeBase = spawnSync("git", ["merge-base", base, "HEAD"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (mergeBase.status === 0) {
        const baseRef = mergeBase.stdout.toString("utf8").trim();
        const headRef = execSync("git rev-parse HEAD", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").trim();
        // If we're on the base branch itself, diff against HEAD~1
        const ref = baseRef === headRef ? "HEAD~1" : baseRef;
        const result = spawnSync("git", ["diff", "--name-only", ref], {
          cwd,
          stdio: ["ignore", "pipe", "ignore"],
        });
        if (result.status === 0) {
          const files = result.stdout.toString("utf8").trim().split("\n").filter(Boolean);
          if (files.length > 0) return files;
        }
      }
    }
    // Fallback: uncommitted + staged changes
    const result = spawnSync("git", ["diff", "--name-only", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0) {
      return result.stdout.toString("utf8").trim().split("\n").filter(Boolean);
    }
  } catch {
    // Not a git repo or git not available
  }
  return [];
}

/**
 * Detect owner/name from git remote origin URL.
 * Supports: git@github.com:owner/repo.git, https://github.com/owner/repo.git
 */
export function detectRepoInfo(cwd: string): { owner: string; name: string } | null {
  try {
    const url = execSync("git remote get-url origin", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8").trim();

    // git@github.com:owner/repo.git
    const sshMatch = url.match(/[:\/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], name: sshMatch[2] };
    }
  } catch {
    // No git remote
  }
  return null;
}

export function resolveCurrentCommitSha(cwd: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();
  } catch {
    return null;
  }
}
