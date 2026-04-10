import type { Command } from "commander";

export function registerReportCommands(program: Command): void {
  const reportCmd = program
    .command("report")
    .description("Normalize and diff reports");

  // subcommands registered in later tasks
  void reportCmd;
}
