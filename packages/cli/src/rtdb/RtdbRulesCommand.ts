import type { FirebaseRtdbRulesJson } from "@gasboost/realtime-firebase";
import type { GasboostConfigLoader } from "../config/GasboostConfigLoader.js";
import type { ModuleLoader } from "../module/ModuleLoader.js";
import type { RtdbRulesWriter } from "./RtdbRulesWriter.js";

type RtdbDefinition = {
  rules(): FirebaseRtdbRulesJson;
};

type RtdbSourceModule = {
  readonly rtdb?: unknown;
};

export class RtdbRulesCommand {
  private readonly configLoader: GasboostConfigLoader;

  private readonly moduleLoader: ModuleLoader;

  private readonly writer: RtdbRulesWriter;

  public constructor({
    configLoader,
    moduleLoader,
    writer,
  }: {
    configLoader: GasboostConfigLoader;
    moduleLoader: ModuleLoader;
    writer: RtdbRulesWriter;
  }) {
    this.configLoader = configLoader;
    this.moduleLoader = moduleLoader;
    this.writer = writer;
  }

  public async execute(): Promise<string> {
    const config = await this.configLoader.load();

    if (config.rtdb === undefined) {
      throw new Error(
        "RTDB configuration was not found in gasboost.config.ts.",
      );
    }

    if (config.rtdb.source.length === 0) {
      throw new Error("rtdb.source must not be empty.");
    }

    if (config.rtdb.out.length === 0) {
      throw new Error("rtdb.out must not be empty.");
    }

    const source = await this.moduleLoader.import<RtdbSourceModule>(
      config.rtdb.source,
    );

    if (
      typeof source.rtdb !== "object" ||
      source.rtdb === null ||
      !("rules" in source.rtdb) ||
      typeof source.rtdb.rules !== "function"
    ) {
      throw new Error(
        `RTDB source '${config.rtdb.source}' must export 'rtdb' with a rules() method.`,
      );
    }

    const rtdb = source.rtdb as RtdbDefinition;

    const rules = rtdb.rules();

    return this.writer.write({
      out: config.rtdb.out,
      rules,
    });
  }
}
