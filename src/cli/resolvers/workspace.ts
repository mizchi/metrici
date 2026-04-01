import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DependencyResolver } from "./types.js";

interface PackageInfo {
  name: string;
  dir: string;
  dependencies: string[];
  testFiles: string[];
}

export class WorkspaceResolver implements DependencyResolver {
  private packages: Map<string, PackageInfo> = new Map();
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.discoverPackages();
  }

  private discoverPackages(): void {
    const rootPkg = this.readPackageJson(this.rootDir);
    let patterns: string[] = [];

    // Try pnpm-workspace.yaml first
    const pnpmWorkspacePath = join(this.rootDir, "pnpm-workspace.yaml");
    if (existsSync(pnpmWorkspacePath)) {
      const content = readFileSync(pnpmWorkspacePath, "utf-8");
      const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (match) {
        patterns = match[1]
          .split("\n")
          .map((l) => l.trim().replace(/^-\s+/, "").replace(/['"]/g, ""))
          .filter(Boolean);
      }
    } else if (rootPkg?.workspaces) {
      patterns = Array.isArray(rootPkg.workspaces)
        ? rootPkg.workspaces
        : (rootPkg.workspaces.packages ?? []);
    }

    // Resolve patterns to package directories
    for (const pattern of patterns) {
      const base = pattern.replace(/\/?\*.*$/, "");
      const baseDir = join(this.rootDir, base);
      if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) continue;

      for (const entry of readdirSync(baseDir)) {
        const pkgDir = join(baseDir, entry);
        const pkgJsonPath = join(pkgDir, "package.json");
        if (!existsSync(pkgJsonPath)) continue;

        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        if (!pkg.name) continue;

        this.packages.set(pkg.name, {
          name: pkg.name,
          dir: relative(this.rootDir, pkgDir),
          dependencies: [],
          testFiles: this.findTestFiles(pkgDir),
        });
      }
    }

    // Second pass: resolve workspace dependencies (now that all packages are known)
    for (const [, info] of this.packages) {
      const pkg = JSON.parse(
        readFileSync(join(this.rootDir, info.dir, "package.json"), "utf-8"),
      );
      info.dependencies = this.extractWorkspaceDeps(pkg);
    }
  }

  private readPackageJson(dir: string): any {
    const p = join(dir, "package.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8"));
  }

  private extractWorkspaceDeps(pkg: any): string[] {
    const deps: string[] = [];
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    for (const [name, version] of Object.entries(allDeps)) {
      if (version.startsWith("workspace:") || this.packages.has(name)) {
        deps.push(name);
      }
    }
    return deps;
  }

  private findTestFiles(pkgDir: string): string[] {
    const testDirs = ["tests", "test", "__tests__", "src"];
    const results: string[] = [];
    for (const dir of testDirs) {
      const testDir = join(pkgDir, dir);
      if (existsSync(testDir) && statSync(testDir).isDirectory()) {
        this.walkDir(testDir, results);
      }
    }
    return results.map((f) => relative(this.rootDir, f));
  }

  private walkDir(dir: string, results: string[]): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules" && entry !== ".git") {
          this.walkDir(full, results);
        }
      } else if (/\.(test|spec)\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry)) {
        results.push(full);
      }
    }
  }

  resolve(changedFiles: string[], allTestFiles: string[]): string[] {
    // 1. Find packages containing changed files
    const changedPackages = new Set<string>();
    for (const file of changedFiles) {
      for (const [name, pkg] of this.packages) {
        if (file.startsWith(pkg.dir + "/") || file.startsWith(pkg.dir + "\\")) {
          changedPackages.add(name);
        }
      }
    }

    // 2. Expand transitively: find all packages that depend on changed packages
    const affected = new Set(changedPackages);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const [name, pkg] of this.packages) {
        if (affected.has(name)) continue;
        for (const dep of pkg.dependencies) {
          if (affected.has(dep)) {
            affected.add(name);
            expanded = true;
            break;
          }
        }
      }
    }

    // 3. Collect test files from affected packages
    const affectedTests = new Set<string>();
    for (const name of affected) {
      const pkg = this.packages.get(name);
      if (pkg) {
        for (const t of pkg.testFiles) {
          affectedTests.add(t);
        }
      }
    }

    // 4. Filter against allTestFiles
    const testSet = new Set(allTestFiles);
    return Array.from(affectedTests).filter((t) => testSet.has(t));
  }
}
