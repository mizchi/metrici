import { basename } from "node:path";
import type { Command } from "commander";
import { runInit } from "../commands/setup/init.js";
import { detectRepoInfo } from "../core/git.js";

export function registerSetupCommands(program: Command): void {
  const setup = program
    .command("setup")
    .description("Project scaffolding");

  setup
    .command("init")
    .description("Create flaker.toml (auto-detects owner/name from git remote)")
    .option("--owner <owner>", "Repository owner (auto-detected from git remote)")
    .option("--name <name>", "Repository name (auto-detected from git remote)")
    .action((opts: { owner?: string; name?: string }) => {
      const cwd = process.cwd();
      const detected = detectRepoInfo(cwd);
      const owner = opts.owner ?? detected?.owner ?? "local";
      const name = opts.name ?? detected?.name ?? basename(cwd);
      runInit(cwd, { owner, name });
      if (!detected && !opts.owner) {
        console.log(`Initialized flaker.toml (${owner}/${name}) — no git remote found, using defaults`);
      } else {
        console.log(`Initialized flaker.toml (${owner}/${name})`);
      }
    });
}
