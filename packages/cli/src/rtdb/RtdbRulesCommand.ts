import { RtdbRulesGenerator } from "@gasboost/config";
import type { ModuleLoader, NormalizedGasboostConfig, RtdbRulesWriter } from "@gasboost/config";

export class RtdbRulesCommand {
  private readonly generator: RtdbRulesGenerator;

  public constructor({
    loadConfig,
    moduleLoader,
    writer,
  }: {
    loadConfig: () => Promise<NormalizedGasboostConfig>;
    moduleLoader: ModuleLoader;
    writer: RtdbRulesWriter;
  }) {
    this.generator = new RtdbRulesGenerator({ loadConfig, moduleLoader, writer });
  }

  public async execute(): Promise<string> {
    return (await this.generator.generate()).outputPath;
  }
}
