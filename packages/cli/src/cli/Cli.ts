import type { CommandRouter } from "./CommandRouter.js";

export class Cli {
  private readonly commandRouter: CommandRouter;

  public constructor(commandRouter: CommandRouter) {
    this.commandRouter = commandRouter;
  }

  public async run(args: readonly string[]): Promise<number> {
    try {
      await this.commandRouter.route(args);

      return 0;
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error(error);
      }

      return 1;
    }
  }
}
