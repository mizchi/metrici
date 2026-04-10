import type { Command } from "commander";

export function registerAnalyzeCommands(program: Command): void {
  const analyze = program
    .command("analyze")
    .description("Read-only inspection of flaker data");

  // subcommands registered in later tasks
  void analyze;
}
