import type { ConsoleOpenCommand } from "../console/ConsoleOpenCommand.js";
import type { RtdbRulesCommand } from "../rtdb/RtdbRulesCommand.js";

export class CommandRouter {
  private readonly consoleOpenCommand: ConsoleOpenCommand;

  private readonly rtdbRulesCommand: RtdbRulesCommand;

  public constructor({
    consoleOpenCommand,
    rtdbRulesCommand,
  }: {
    consoleOpenCommand: ConsoleOpenCommand;
    rtdbRulesCommand: RtdbRulesCommand;
  }) {
    this.consoleOpenCommand = consoleOpenCommand;
    this.rtdbRulesCommand = rtdbRulesCommand;
  }

  public async route(args: readonly string[]): Promise<void> {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      console.log(
        [
          "Usage:",
          "  gasboost console open [--no-browser]",
          "  gasboost rtdb rules",
        ].join("\n"),
      );

      return;
    }

    if (
      args[0] === "console" &&
      args[1] === "open" &&
      (args.length === 2 || (args.length === 3 && args[2] === "--no-browser"))
    ) {
      const url = await this.consoleOpenCommand.execute({
        openBrowser: args[2] !== "--no-browser",
      });
      console.log(`Gasboost Console opened: ${url}`);
      return;
    }

    if (args[0] === "rtdb" && args[1] === "rules" && args.length === 2) {
      const outputPath = await this.rtdbRulesCommand.execute();

      console.log(`Firebase RTDB Security Rules generated: ${outputPath}`);

      return;
    }

    throw new Error(`Unknown command: ${args.join(" ")}`);
  }
}
