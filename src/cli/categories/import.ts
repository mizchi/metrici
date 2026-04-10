import type { Command } from "commander";

export function registerImportCommands(program: Command): void {
  const importCmd = program
    .command("import")
    .description("Ingest external reports");

  // subcommands registered in later tasks
  void importCmd;
}
