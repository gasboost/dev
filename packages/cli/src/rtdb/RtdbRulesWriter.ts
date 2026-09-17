import type { FirebaseRtdbRulesJson } from "@gasboost/realtime-firebase";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
