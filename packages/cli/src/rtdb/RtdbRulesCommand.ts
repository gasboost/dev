import type { FirebaseRtdbRulesJson } from "@gasboost/realtime-firebase";
import type { ModuleLoader, NormalizedGasboostConfig } from "@gasboost/config";
import type { RtdbRulesWriter } from "./RtdbRulesWriter.js";

type RtdbDefinition = {
  rules(): FirebaseRtdbRulesJson;
};

type RtdbSourceModule = {
  readonly rtdb?: unknown;
};

export class RtdbRulesCommand {
  private readonly loadConfig: () => Promise<NormalizedGasboostConfig>;

  private readonly moduleLoader: ModuleLoader;

  private readonly writer: RtdbRulesWriter;

  public constructor({
    loadConfig,
    moduleLoader,
    writer,
  }: {
    loadConfig: () => Promise<NormalizedGasboostConfig>;
    moduleLoader: ModuleLoader;
    writer: RtdbRulesWriter;
  }) {
    this.loadConfig = loadConfig;
    this.moduleLoader = moduleLoader;
    this.writer = writer;
  }

  public async execute(): Promise<string> {
    const config = await this.loadConfig();
    const rtdb = config.firebase?.realtimeDatabase;

    if (rtdb === undefined) {
      throw new Error(
        "RTDB configuration was not found in gasboost.config.ts.",
      );
    }

    if (rtdb.source.length === 0) {
      throw new Error("firebase.realtimeDatabase.source must not be empty.");
    }

    if (rtdb.out.length === 0) {
      throw new Error("firebase.realtimeDatabase.out must not be empty.");
    }

    const source = await this.moduleLoader.import<RtdbSourceModule>(
      rtdb.source,
    );

    if (
      typeof source.rtdb !== "object" ||
      source.rtdb === null ||
      !("rules" in source.rtdb) ||
      typeof source.rtdb.rules !== "function"
    ) {
      throw new Error(
        `RTDB source '${rtdb.source}' must export 'rtdb' with a rules() method.`,
      );
    }

    const definition = source.rtdb as RtdbDefinition;

    const rules = definition.rules();

    return this.writer.write({
      out: rtdb.out,
      rules,
    });
  }
}
