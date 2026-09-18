import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevelopmentOperations } from "../src/index.js";

describe("Development operations", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    directories.length = 0;
  });

  async function createProject(packageJson: string): Promise<string> {
    const projectRoot = await mkdtemp(join(tmpdir(), "gasboost-development-"));
    directories.push(projectRoot);
    await writeFile(join(projectRoot, "package.json"), packageJson, "utf8");
    return projectRoot;
  }

  it("registered operation idsを公開する", async () => {
    const projectRoot = await createProject('{"scripts":{"dev":"vite"}}');
    const { operations } = createDevelopmentOperations({ projectRoot });

    expect(operations.map(({ id }) => id)).toEqual([
      "development.status",
      "development.start",
      "development.stop",
      "development.restart",
      "development.open",
    ]);
  });

  it("dev scriptが無いprojectではstartを拒否する", async () => {
    const projectRoot = await createProject('{"scripts":{"build":"tsc"}}');
    const { operations } = createDevelopmentOperations({ projectRoot });
    const start = operations.find(({ id }) => id === "development.start");

    await expect(start?.handler({}, context())).rejects.toThrow("No package.json dev script");
  });

  it("dev serverが出力したcustom portのURLをstatusとopenに使用する", async () => {
    const projectRoot = await createProject('{"scripts":{"dev":"node server.mjs"}}');
    await writeFile(
      join(projectRoot, "server.mjs"),
      'console.log("Local: http://localhost:4317/");\nsetInterval(() => {}, 1000);\n',
      "utf8",
    );
    const browserOpener = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
    const { operations, cleanup } = createDevelopmentOperations({
      projectRoot,
      browserOpener,
    });
    const start = operations.find(({ id }) => id === "development.start");
    const status = operations.find(({ id }) => id === "development.status");
    const open = operations.find(({ id }) => id === "development.open");

    try {
      const starting = await start?.handler({}, context());
      expect(starting?.localUrl).not.toBe("http://127.0.0.1:5173");

      await vi.waitFor(async () => {
        await expect(status?.handler({}, context())).resolves.toMatchObject({
          running: true,
          localUrl: "http://127.0.0.1:4317/",
        });
      });

      await open?.handler({}, context());
      expect(browserOpener).toHaveBeenCalledWith("http://127.0.0.1:4317/");
    } finally {
      await cleanup();
    }
  });
});

function context() {
  return { log: vi.fn(), progress: vi.fn() };
}
