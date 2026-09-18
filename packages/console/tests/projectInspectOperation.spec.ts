import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectInspectOperation } from "../src/index.js";

describe("project.inspect", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
    directories.length = 0;
  });

  it("configからproject capabilitiesを返す", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gasboost-console-"));
    directories.push(projectRoot);
    await writeFile(
      join(projectRoot, "gasboost.config.ts"),
      `export default {
        appsScript: { type: "webapp" },
        firebase: {
          realtimeDatabase: {
            source: "./src/rtdb.ts",
            out: "./database.rules.json",
          },
        },
      };`,
      "utf8",
    );
    const operation = createProjectInspectOperation(projectRoot);
    const progress = vi.fn();
    const log = vi.fn();

    await expect(operation.handler({}, { progress, log })).resolves.toEqual({
      name: projectRoot.split("/").at(-1),
      root: projectRoot,
      capabilities: {
        appsScript: true,
        firebaseRealtimeDatabase: true,
      },
    });
    expect(progress).toHaveBeenLastCalledWith({
      message: "Project ready",
      percentage: 100,
    });
    expect(log).toHaveBeenCalledWith("gasboost.config.ts loaded");
  });
});
