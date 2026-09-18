import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGasboostConfig } from "../src/index.js";

describe("loadGasboostConfig", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    directories.length = 0;
  });

  async function createProject(config: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "gasboost-config-"));
    directories.push(root);
    await writeFile(join(root, "gasboost.config.ts"), config, "utf8");
    return root;
  }

  it("canonical configを読み込む", async () => {
    const projectRoot = await createProject(`
export default {
  appsScript: { type: "webapp" },
  firebase: {
    realtimeDatabase: {
      source: "./src/rtdb.ts",
      out: "./database.rules.json",
    },
  },
};
`);

    await expect(loadGasboostConfig({ projectRoot })).resolves.toEqual({
      appsScript: { type: "webapp" },
      firebase: {
        realtimeDatabase: {
          source: "./src/rtdb.ts",
          out: "./database.rules.json",
        },
      },
    });
  });

  it("legacy rtdb configをcanonical shapeへ正規化する", async () => {
    const projectRoot = await createProject(`
export default {
  rtdb: {
    source: "./src/rtdb.ts",
    out: "./database.rules.json",
  },
};
`);

    await expect(loadGasboostConfig({ projectRoot })).resolves.toEqual({
      firebase: {
        realtimeDatabase: {
          source: "./src/rtdb.ts",
          out: "./database.rules.json",
        },
      },
    });
  });

  it("default exportがobjectでなければ失敗する", async () => {
    const projectRoot = await createProject("export default 'invalid';\n");

    await expect(loadGasboostConfig({ projectRoot })).rejects.toThrow(
      "must export a Gasboost config as the default export",
    );
  });

  it("config fileがなければ失敗する", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gasboost-config-"));
    directories.push(projectRoot);

    await expect(loadGasboostConfig({ projectRoot })).rejects.toThrow(
      "Gasboost config was not found",
    );
  });
});
