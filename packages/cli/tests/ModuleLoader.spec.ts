import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModuleLoader } from "@gasboost/config";

describe("ModuleLoader", () => {
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

  it("TypeScript moduleを実行できる", async () => {
    const root = await mkdtemp(join(tmpdir(), "gasboost-cli-"));

    directories.push(root);

    await writeFile(
      join(root, "source.ts"),
      ["const value: string = 'loaded';", "export { value };"].join("\n"),
      "utf8",
    );

    const loader = new ModuleLoader(root);

    const module = await loader.import<{
      readonly value: string;
    }>("source.ts");

    expect(module.value).toBe("loaded");
  });

  it("tsconfig pathsを解決できる", async () => {
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
      join(root, "src", "value.ts"),
      "export const value = 'alias-loaded';\n",
      "utf8",
    );

    await writeFile(
      join(root, "source.ts"),
      ['import { value } from "@/value";', "export { value };"].join("\n"),
      "utf8",
    );

    const loader = new ModuleLoader(root);

    const module = await loader.import<{
      readonly value: string;
    }>("source.ts");

    expect(module.value).toBe("alias-loaded");
  });
});
