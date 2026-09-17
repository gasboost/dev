import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GasboostConfigLoader } from "../src/config/GasboostConfigLoader.js";
import { ModuleLoader } from "../src/module/ModuleLoader.js";
import { RtdbRulesCommand } from "../src/rtdb/RtdbRulesCommand.js";
import { RtdbRulesWriter } from "../src/rtdb/RtdbRulesWriter.js";

describe("RtdbRulesCommand", () => {
  const directories: string[] = [];

  afterEach(async () => {
    for (const directory of directories) {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }

    directories.length = 0;
  });

  it("rtdb sourceからdatabase.rules.jsonを生成する", async () => {
    const root = await mkdtemp(join(tmpdir(), "gasboost-cli-"));

    directories.push(root);

    await mkdir(join(root, "src"), {
      recursive: true,
    });

    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["./src/*"],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      join(root, "src", "rules.ts"),
      [
        "export const generatedRules = {",
        "  rules: {",
        '    ".read": false,',
        '    ".write": false,',
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      join(root, "src", "rtdb.ts"),
      [
        'import { generatedRules } from "@/rules";',
        "",
        "export const rtdb = {",
        "  rules() {",
        "    return generatedRules;",
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      join(root, "gasboost.config.ts"),
      [
        "export default {",
        "  rtdb: {",
        '    source: "./src/rtdb.ts",',
        '    out: "./database.rules.json",',
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    const moduleLoader = new ModuleLoader(root);

    const command = new RtdbRulesCommand({
      configLoader: new GasboostConfigLoader({
        projectRoot: root,
        moduleLoader,
      }),
      moduleLoader,
      writer: new RtdbRulesWriter(root),
    });

    const outputPath = await command.execute();

    expect(outputPath).toBe(join(root, "database.rules.json"));

    const output = await readFile(outputPath, "utf8");

    expect(JSON.parse(output)).toEqual({
      rules: {
        ".read": false,
        ".write": false,
      },
    });
  });

  it("rtdb configがなければ失敗する", async () => {
    const root = await mkdtemp(join(tmpdir(), "gasboost-cli-"));

    directories.push(root);

    await writeFile(
      join(root, "gasboost.config.ts"),
      "export default {};\n",
      "utf8",
    );

    const moduleLoader = new ModuleLoader(root);

    const command = new RtdbRulesCommand({
      configLoader: new GasboostConfigLoader({
        projectRoot: root,
        moduleLoader,
      }),
      moduleLoader,
      writer: new RtdbRulesWriter(root),
    });

    await expect(command.execute()).rejects.toThrow(
      "RTDB configuration was not found in gasboost.config.ts.",
    );
  });

  it("sourceがrtdbをexportしていなければ失敗する", async () => {
    const root = await mkdtemp(join(tmpdir(), "gasboost-cli-"));

    directories.push(root);

    await mkdir(join(root, "src"), {
      recursive: true,
    });

    await writeFile(
      join(root, "src", "rtdb.ts"),
      "export const value = true;\n",
      "utf8",
    );

    await writeFile(
      join(root, "gasboost.config.ts"),
      [
        "export default {",
        "  rtdb: {",
        '    source: "./src/rtdb.ts",',
        '    out: "./database.rules.json",',
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    const moduleLoader = new ModuleLoader(root);

    const command = new RtdbRulesCommand({
      configLoader: new GasboostConfigLoader({
        projectRoot: root,
        moduleLoader,
      }),
      moduleLoader,
      writer: new RtdbRulesWriter(root),
    });

    await expect(command.execute()).rejects.toThrow(
      "must export 'rtdb' with a rules() method.",
    );
  });

  it("rules()のerrorを握りつぶさない", async () => {
    const root = await mkdtemp(join(tmpdir(), "gasboost-cli-"));

    directories.push(root);

    await mkdir(join(root, "src"), {
      recursive: true,
    });

    await writeFile(
      join(root, "src", "rtdb.ts"),
      [
        "export const rtdb = {",
        "  rules() {",
        '    throw new Error("projectability error");',
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      join(root, "gasboost.config.ts"),
      [
        "export default {",
        "  rtdb: {",
        '    source: "./src/rtdb.ts",',
        '    out: "./database.rules.json",',
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    const moduleLoader = new ModuleLoader(root);

    const command = new RtdbRulesCommand({
      configLoader: new GasboostConfigLoader({
        projectRoot: root,
        moduleLoader,
      }),
      moduleLoader,
      writer: new RtdbRulesWriter(root),
    });

    await expect(command.execute()).rejects.toThrow("projectability error");
  });
});
