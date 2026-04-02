import { loadConfig } from "../config.js";
import { hasMoonBitJsBuild } from "../core/loader.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

export interface DoctorDeps {
  createStore: () => { initialize: () => Promise<void>; close: () => Promise<void> };
  hasMoonBitBuild: () => Promise<boolean>;
  canLoadConfig: () => boolean;
}

export async function runDoctor(cwd: string, deps?: Partial<DoctorDeps>): Promise<DoctorReport> {
  const resolved: DoctorDeps = {
    createStore: deps?.createStore ?? (() => { throw new Error("createStore is not configured"); }),
    hasMoonBitBuild: deps?.hasMoonBitBuild ?? hasMoonBitJsBuild,
    canLoadConfig: deps?.canLoadConfig ?? (() => {
      loadConfig(cwd);
      return true;
    }),
  };

  const checks: DoctorCheck[] = [];

  // Config check
  try {
    const ok = resolved.canLoadConfig();
    checks.push({
      name: "config",
      ok,
      detail: ok ? "flaker.toml is readable" : "flaker.toml check returned false",
    });
  } catch (error) {
    checks.push({
      name: "config",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // DuckDB check
  const store = resolved.createStore();
  let storeInitialized = false;
  try {
    await store.initialize();
    storeInitialized = true;
    await store.close();
    checks.push({ name: "duckdb", ok: true, detail: "DuckDB initialized successfully" });
  } catch (error) {
    checks.push({
      name: "duckdb",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (storeInitialized) {
      try {
        await store.close();
      } catch {
        // best effort
      }
    }
  }

  // MoonBit build check
  try {
    const hasBuild = await resolved.hasMoonBitBuild();
    checks.push({
      name: "moonbit",
      ok: true,
      detail: hasBuild
        ? "MoonBit JS build detected"
        : "MoonBit JS build not found (TypeScript fallback will be used)",
    });
  } catch (error) {
    checks.push({
      name: "moonbit",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    checks,
    ok: checks.every((c) => c.ok),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map((c) => `${c.ok ? "OK" : "NG"} ${c.name}: ${c.detail}`);
  lines.push("");
  lines.push(report.ok ? "Doctor checks passed." : "Doctor checks failed.");
  return lines.join("\n");
}
