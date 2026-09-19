import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ModuleLoader } from "./ModuleLoader.js";
import type { NormalizedGasboostConfig } from "./GasboostConfig.js";

export type FirebaseRtdbRulesJson = Record<string, unknown>;

type RtdbDefinition = {
  rules(): FirebaseRtdbRulesJson;
};

type RtdbSourceModule = {
  readonly rtdb?: unknown;
};

export type RtdbRulesGenerationResult = {
  readonly outputPath: string;
  readonly source: string;
  readonly out: string;
};

export class RtdbRulesGenerator {
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

  public async generate(): Promise<RtdbRulesGenerationResult> {
    const config = await this.loadConfig();
    const rtdb = config.firebase?.realtimeDatabase;

    if (rtdb === undefined) {
      throw new Error("RTDB configuration was not found in gasboost.config.ts.");
    }

    if (rtdb.source.length === 0) {
      throw new Error("firebase.realtimeDatabase.source must not be empty.");
    }

    if (rtdb.out.length === 0) {
      throw new Error("firebase.realtimeDatabase.out must not be empty.");
    }

    const source = await this.moduleLoader.import<RtdbSourceModule>(rtdb.source);

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

    const rules = (source.rtdb as RtdbDefinition).rules();
    const outputPath = await this.writer.write({
      out: rtdb.out,
      rules,
    });

    return {
      outputPath,
      source: rtdb.source,
      out: rtdb.out,
    };
  }
}

export class RtdbRulesWriter {
  private readonly projectRoot: string;

  public constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  public async write({
    out,
    rules,
  }: {
    out: string;
    rules: FirebaseRtdbRulesJson;
  }): Promise<string> {
    const outputPath = resolve(this.projectRoot, out);

    await mkdir(dirname(outputPath), {
      recursive: true,
    });

    await writeFile(outputPath, `${JSON.stringify(rules, null, 2)}\n`, "utf8");

    return outputPath;
  }
}
