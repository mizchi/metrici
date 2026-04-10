import type { Command } from "commander";

export function registerDebugCommands(program: Command): void {
  const debug = program
    .command("debug")
    .description("Active investigation and environment checks");

  // subcommands registered in later tasks
  void debug;
}
