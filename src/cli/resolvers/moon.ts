import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DependencyResolver } from "./types.js";

interface MoonPackage {
  path: string;
  imports: string[];
  testFiles: string[];
  sourceFiles: string[];
}

export class MoonResolver implements DependencyResolver {
  private packages: Map<string, MoonPackage> = new Map();
  private rootDir: string;
  private projectName: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.projectName = this.readProjectName();
    this.discoverPackages();
  }

  private readProjectName(): string {
    const modPath = join(this.rootDir, "moon.mod.json");
    if (existsSync(modPath)) {
      try {
        const mod = JSON.parse(readFileSync(modPath, "utf-8"));
        return mod.name ?? "";
      } catch {
        return "";
      }
    }
    return "";
  }

  private discoverPackages(): void {
    this.walkForPackages(this.rootDir);
  }

  private walkForPackages(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    const hasPkg =
      entries.includes("moon.pkg") || entries.includes("moon.pkg.json");
    if (hasPkg) {
      const relPath = relative(this.rootDir, dir) || ".";
      const pkgConfig = this.readMoonPkg(dir);
      const imports = this.extractImports(pkgConfig);
      const mbtFiles = entries.filter((e) => e.endsWith(".mbt"));
      const testFiles = mbtFiles
        .filter((f) => f.endsWith("_test.mbt"))
        .map((f) => (relPath === "." ? f : join(relPath, f)));
      const sourceFiles = mbtFiles
        .filter((f) => !f.endsWith("_test.mbt"))
        .map((f) => (relPath === "." ? f : join(relPath, f)));

      this.packages.set(relPath, {
        path: relPath,
        imports,
        testFiles,
        sourceFiles,
      });
    }

    for (const entry of entries) {
      if (
        entry === "node_modules" ||
        entry === ".git" ||
        entry === "_build" ||
        entry === "target" ||
        entry === ".mooncakes"
      )
        continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          this.walkForPackages(full);
        }
      } catch {
        // skip inaccessible
      }
    }
  }

  private readMoonPkg(dir: string): any {
    for (const name of ["moon.pkg", "moon.pkg.json"]) {
      const p = join(dir, name);
      if (existsSync(p)) {
        try {
          return JSON.parse(readFileSync(p, "utf-8"));
        } catch {
          // not valid JSON
        }
      }
    }
    return {};
  }

  private extractImports(config: any): string[] {
    if (!config.import) return [];
    if (Array.isArray(config.import)) {
      return config.import
        .map((imp: any) => {
          if (typeof imp === "string") return imp;
          if (typeof imp === "object" && imp.path) return imp.path;
          return null;
        })
        .filter(Boolean);
    }
    return [];
  }

  /** Resolve an import string like "project/src/types" to a local package path like "src/types" */
  private resolveImportToPath(imp: string): string | null {
    // If import starts with project name, strip it
    if (this.projectName && imp.startsWith(this.projectName + "/")) {
      const localPath = imp.slice(this.projectName.length + 1);
      if (this.packages.has(localPath)) return localPath;
    }
    // Direct match
    if (this.packages.has(imp)) return imp;
    // Try suffix match
    for (const [knownPath] of this.packages) {
      if (imp.endsWith("/" + knownPath) || imp === knownPath) {
        return knownPath;
      }
    }
    return null;
  }

  resolve(changedFiles: string[], allTestFiles: string[]): string[] {
    // 1. Find packages containing changed files
    const changedPackages = new Set<string>();
    for (const file of changedFiles) {
      for (const [path, pkg] of this.packages) {
        if (
          file.startsWith(path + "/") ||
          file === path ||
          pkg.sourceFiles.includes(file) ||
          pkg.testFiles.includes(file)
        ) {
          changedPackages.add(path);
        }
      }
    }

    // 2. Build reverse dependency map
    const dependents: Map<string, string[]> = new Map();
    for (const [path, pkg] of this.packages) {
      for (const imp of pkg.imports) {
        const resolved = this.resolveImportToPath(imp);
        if (resolved) {
          if (!dependents.has(resolved)) dependents.set(resolved, []);
          dependents.get(resolved)!.push(path);
        }
      }
    }

    // 3. Expand transitively via reverse deps
    const affected = new Set(changedPackages);
    const queue = [...changedPackages];
    while (queue.length > 0) {
      const pkg = queue.pop()!;
      const deps = dependents.get(pkg) ?? [];
      for (const dep of deps) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    }

    // 4. Collect test files
    const affectedTests = new Set<string>();
    for (const path of affected) {
      const pkg = this.packages.get(path);
      if (pkg) {
        for (const t of pkg.testFiles) {
          affectedTests.add(t);
        }
      }
    }

    const testSet = new Set(allTestFiles);
    return Array.from(affectedTests).filter((t) => testSet.has(t));
  }
}
