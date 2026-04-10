import type { Command } from "commander";

export function registerCollectCommands(program: Command): void {
  const collect = program
    .command("collect")
    .description("Import history and calibration");

  // subcommands registered in later tasks
  void collect;
}
