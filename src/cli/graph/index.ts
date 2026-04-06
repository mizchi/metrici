import type { GraphAdapter } from "./types.js";
import { NpmWorkspaceAdapter } from "./adapters/npm.js";
import { MoonAdapter } from "./adapters/moon.js";
import { CargoAdapter } from "./adapters/cargo.js";
import { ActrunWorkflowAdapter } from "./adapters/actrun.js";

const ALL_ADAPTERS: GraphAdapter[] = [
  new NpmWorkspaceAdapter(),
  new MoonAdapter(),
  new CargoAdapter(),
  new ActrunWorkflowAdapter(),
];

/** Auto-detect which adapters apply to a directory */
export function detectAdapters(rootDir: string): GraphAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.detect(rootDir));
}

/** Get adapter by name */
export function getAdapter(name: string): GraphAdapter {
  const adapter = ALL_ADAPTERS.find((a) => a.name === name);
  if (!adapter) throw new Error(`Unknown graph adapter: ${name}`);
  return adapter;
}

export * from "./types.js";
