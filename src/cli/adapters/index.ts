import type { TestResultAdapter } from "./types.js";
import { CustomAdapter } from "./custom.js";
import { junitAdapter } from "./junit.js";
import { playwrightAdapter } from "./playwright.js";
import { vrtBenchAdapter } from "./vrt-bench.js";
import { vitestAdapter } from "./vitest.js";
import { vrtMigrationAdapter } from "./vrt-migration.js";
import { tapAdapter } from "./tap.js";
import { gotestAdapter } from "./gotest.js";
import { cargoTestAdapter } from "./cargo.js";
import { moontestAdapter } from "./moontest.js";
import { chaosbringerAdapter } from "./chaosbringer.js";

export function createTestResultAdapter(
  type: string,
  customCommand?: string,
): TestResultAdapter {
  switch (type) {
    case "playwright":
      return playwrightAdapter;
    case "vitest":
      return vitestAdapter;
    case "junit":
      return junitAdapter;
    case "vrt-migration":
      return vrtMigrationAdapter;
    case "vrt-bench":
      return vrtBenchAdapter;
    case "tap":
      return tapAdapter;
    case "gotest":
      return gotestAdapter;
    case "cargo-test":
      return cargoTestAdapter;
    case "moontest":
      return moontestAdapter;
    case "chaosbringer":
      return chaosbringerAdapter;
    case "custom":
      if (!customCommand) {
        throw new Error("Custom adapter requires a command (customCommand)");
      }
      return new CustomAdapter({ command: customCommand });
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}
