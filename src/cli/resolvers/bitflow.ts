import type { DependencyResolver } from "./types.js";

export type ExecFn = (command: string) => Promise<{ stdout: string; stderr: string }>;

export class BitflowResolver implements DependencyResolver {
  private configPath: string;
  private exec: ExecFn;

  constructor(configPath: string, exec: ExecFn) {
    this.configPath = configPath;
    this.exec = exec;
  }

  async resolve(changedFiles: string[], allTestFiles: string[]): Promise<string[]> {
    const changedArg = changedFiles.join(",");
    const { stdout } = await this.exec(
      `bitflow affected --config ${this.configPath} --changed ${changedArg}`,
    );

    const affectedFiles = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const knownTests = new Set(allTestFiles);
    return affectedFiles.filter((f) => knownTests.has(f));
  }
}
