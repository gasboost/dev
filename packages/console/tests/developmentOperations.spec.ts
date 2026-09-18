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
      expect(starting).toMatchObject({
        running: true,
        localUrl: "http://127.0.0.1:4317/",
      });

      await expect(status?.handler({}, context())).resolves.toMatchObject({
        running: true,
        localUrl: "http://127.0.0.1:4317/",
      });

      await open?.handler({}, context());
      expect(browserOpener).toHaveBeenCalledWith("http://127.0.0.1:4317/");
    } finally {
      await cleanup();
    }
  });

  it("dev serverのURL検出までstart resultを待つ", async () => {
    const projectRoot = await createProject('{"scripts":{"dev":"node server.mjs"}}');
    await writeFile(
      join(projectRoot, "server.mjs"),
      'setTimeout(() => console.log("ready http://localhost:4319/"), 50);\nsetInterval(() => {}, 1000);\n',
      "utf8",
    );
    const { operations, cleanup } = createDevelopmentOperations({ projectRoot });
    const start = operations.find(({ id }) => id === "development.start");

    try {
      await expect(start?.handler({}, context())).resolves.toMatchObject({
        running: true,
        localUrl: "http://127.0.0.1:4319/",
      });
    } finally {
      await cleanup();
    }
  });

  it("dev serverがURLを出さない場合はtimeout後にrunning stateを返す", async () => {
    const projectRoot = await createProject('{"scripts":{"dev":"node server.mjs"}}');
    await writeFile(
      join(projectRoot, "server.mjs"),
      'console.log("ready without url");\nsetInterval(() => {}, 1000);\n',
      "utf8",
    );
    const { operations, cleanup } = createDevelopmentOperations({
      projectRoot,
      urlDetectionTimeoutMs: 25,
    });
    const start = operations.find(({ id }) => id === "development.start");

    try {
      await expect(start?.handler({}, context())).resolves.toMatchObject({
        running: true,
      });
      expect(await start?.handler({}, context())).not.toHaveProperty("localUrl");
    } finally {
      await cleanup();
    }
  });

  it("colorized outputからcleanなURLを検出してopenに渡す", async () => {
    const projectRoot = await createProject('{"scripts":{"dev":"node server.mjs"}}');
    await writeFile(
      join(projectRoot, "server.mjs"),
      'process.stdout.write("Local: \\u001b[32mhttp://localhost:4320/\\u001b[0m\\n");\nsetInterval(() => {}, 1000);\n',
      "utf8",
    );
    const browserOpener = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
    const { operations, cleanup } = createDevelopmentOperations({
      projectRoot,
      browserOpener,
    });
    const start = operations.find(({ id }) => id === "development.start");
    const open = operations.find(({ id }) => id === "development.open");

    try {
      await expect(start?.handler({}, context())).resolves.toMatchObject({
        localUrl: "http://127.0.0.1:4320/",
      });

      await open?.handler({}, context());
      expect(browserOpener).toHaveBeenCalledWith("http://127.0.0.1:4320/");
      expect(browserOpener.mock.calls[0]?.[0]).not.toContain("\u001b");
    } finally {
      await cleanup();
    }
  });

  it("localUrlが無い場合はopenを明示errorにする", async () => {
    const projectRoot = await createProject('{"scripts":{"dev":"node server.mjs"}}');
    await writeFile(
      join(projectRoot, "server.mjs"),
      'setInterval(() => {}, 1000);\n',
      "utf8",
    );
    const browserOpener = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
    const { operations, cleanup } = createDevelopmentOperations({
      projectRoot,
      browserOpener,
      urlDetectionTimeoutMs: 25,
    });
    const start = operations.find(({ id }) => id === "development.start");
    const open = operations.find(({ id }) => id === "development.open");

    try {
      await start?.handler({}, context());
      await expect(open?.handler({}, context())).rejects.toThrow(
        "Local application URL is not available yet",
      );
      expect(browserOpener).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("running processが無い場合はopenを明示errorにする", async () => {
    const projectRoot = await createProject('{"scripts":{"dev":"node server.mjs"}}');
    const browserOpener = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
    const { operations } = createDevelopmentOperations({ projectRoot, browserOpener });
    const open = operations.find(({ id }) => id === "development.open");

    await expect(open?.handler({}, context())).rejects.toThrow(
      "Start the local application first",
    );
    expect(browserOpener).not.toHaveBeenCalled();
  });
});

function context() {
  return { log: vi.fn(), progress: vi.fn() };
}
