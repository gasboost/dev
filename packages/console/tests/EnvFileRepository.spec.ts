import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnvFileRepository } from "../src/env/EnvFileRepository.js";

describe("EnvFileRepository", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
    directories.length = 0;
  });

  async function createProject(): Promise<string> {
    const projectRoot = await mkdtemp(join(tmpdir(), "gasboost-env-"));
    directories.push(projectRoot);
    return projectRoot;
  }

  it("updates managed runtime identifiers without destroying unrelated values", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".env"),
      [
        "# local settings",
        "GAS_SCRIPT_ID=old-script",
        "OTHER_VALUE=keep-me",
        "GAS_SCRIPT_ID=duplicate",
        "",
      ].join("\n"),
      "utf8",
    );

    await new EnvFileRepository(projectRoot).update({
      GAS_SCRIPT_ID: "new-script",
      FIREBASE_PROJECT_ID: "firebase-project",
    });

    await expect(readFile(join(projectRoot, ".env"), "utf8")).resolves.toBe(
      [
        "# local settings",
        "GAS_SCRIPT_ID=new-script",
        "OTHER_VALUE=keep-me",
        "",
        "FIREBASE_PROJECT_ID=firebase-project",
        "",
      ].join("\n"),
    );
  });
});
