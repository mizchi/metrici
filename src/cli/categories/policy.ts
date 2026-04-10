import type { Command } from "commander";

export function registerPolicyCommands(program: Command): void {
  const policy = program
    .command("policy")
    .description("Enforcement and ownership");

  // subcommands registered in later tasks
  void policy;
}
