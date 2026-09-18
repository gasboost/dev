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
});

function context() {
  return { log: vi.fn(), progress: vi.fn() };
}
