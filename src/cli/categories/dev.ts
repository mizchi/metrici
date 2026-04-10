import type { Command } from "commander";

export function registerDevCommands(program: Command): void {
  const dev = program
    .command("dev")
    .description("Model training and benchmarks");

  // subcommands registered in later tasks
  void dev;
}
