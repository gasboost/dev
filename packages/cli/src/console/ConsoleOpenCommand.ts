import { startGasboostConsole } from "@gasboost/console";

export class ConsoleOpenCommand {
  private readonly projectRoot: string;

  public constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  public async execute({
    openBrowser,
  }: {
    readonly openBrowser: boolean;
  }): Promise<string> {
    const runtime = await startGasboostConsole({
      projectRoot: this.projectRoot,
      openBrowser,
    });

    return runtime.url;
  }
}
