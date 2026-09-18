import type { RtdbRulesCommand } from "../rtdb/RtdbRulesCommand.js";

export class CommandRouter {
  private readonly rtdbRulesCommand: RtdbRulesCommand;

  public constructor(rtdbRulesCommand: RtdbRulesCommand) {
    this.rtdbRulesCommand = rtdbRulesCommand;
  }

  public async route(args: readonly string[]): Promise<void> {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      console.log(["Usage:", "  gasboost rtdb rules"].join("\n"));

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
