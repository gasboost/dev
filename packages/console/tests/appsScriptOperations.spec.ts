import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppsScriptOperations,
  type ClaspRunner,
} from "../src/index.js";

describe("Apps Script operations", () => {
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
    const projectRoot = await mkdtemp(join(tmpdir(), "gasboost-apps-"));
    directories.push(projectRoot);
    return projectRoot;
  }

  it("credentialを受け取るoperationを公開しない", async () => {
    const projectRoot = await createProject();
    const operations = createAppsScriptOperations({
      projectRoot,
      config: { type: "webapp" },
      clasp: {
        run: vi.fn(async () => ({ exitCode: 0, stdout: "{}", stderr: "" })),
      },
    });

    expect(operations.map(({ id }) => id)).not.toContain("apps.credentials.register");
  });

  it("authorizationと.clasp.jsonからstatusを返す", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".clasp.json"),
      JSON.stringify({ scriptId: "script-123", rootDir: "dist" }),
      "utf8",
    );
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "{}", stderr: "" }));
    const operation = operationById(
      createAppsScriptOperations({
        projectRoot,
        config: { type: "webapp" },
        clasp: { run },
      }),
      "apps.status",
    );

    await expect(operation.handler({}, context())).resolves.toMatchObject({
      authenticated: true,
      configured: true,
      scriptId: "script-123",
      rootDir: "dist",
      manifestExists: false,
      desired: true,
    });
    expect(run).toHaveBeenCalledWith(["show-authorized-user", "--json"]);
  });

  it("rootDir配下のmanifestをactual stateとして検出する", async () => {
    const projectRoot = await createProject();
    await mkdir(join(projectRoot, "dist"));
    await writeFile(
      join(projectRoot, ".clasp.json"),
      JSON.stringify({ scriptId: "script-123", rootDir: "dist" }),
      "utf8",
    );
    await writeFile(join(projectRoot, "dist", "appsscript.json"), "{}", "utf8");
    const operations = createAppsScriptOperations({
      projectRoot,
      config: { type: "webapp" },
      clasp: {
        run: vi.fn(async () => ({ exitCode: 0, stdout: "{}", stderr: "" })),
      },
    });

    await expect(
      operationById(operations, "apps.status").handler({}, context()),
    ).resolves.toMatchObject({ rootDir: "dist", manifestExists: true });
  });

  it("connectで既存.clasp.jsonの管理対象外fieldを保持する", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".clasp.json"),
      JSON.stringify({
        scriptId: "old-script",
        rootDir: "build",
        filePushOrder: ["a.js"],
      }),
      "utf8",
    );
    const operations = createAppsScriptOperations({
      projectRoot,
      config: { type: "webapp" },
      clasp: {
        run: vi.fn(async () => ({ exitCode: 0, stdout: "{}", stderr: "" })),
      },
    });

    await operationById(operations, "apps.connect").handler(
      { scriptId: "new-script" },
      context(),
    );

    const settings = JSON.parse(
      await readFile(join(projectRoot, ".clasp.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(settings).toEqual({
      scriptId: "new-script",
      rootDir: "build",
      filePushOrder: ["a.js"],
    });
  });

  it("schema-valid titleだけでwebapp projectを作成する", async () => {
    const projectRoot = await createProject();
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "create-script") {
        await writeFile(
          join(projectRoot, ".clasp.json"),
          JSON.stringify({ scriptId: "created-script", rootDir: "build" }),
          "utf8",
        );
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const operation = operationById(
      createAppsScriptOperations({
        projectRoot,
        config: { type: "webapp", rootDir: "build" },
        clasp: { run },
      }),
      "apps.create",
    );

    expect(operation.input.safeParse({ title: "My Web App" }).success).toBe(true);
    expect(operation.input.safeParse({ title: "" }).success).toBe(false);
    expect(operation.input.safeParse({ title: "App", args: ["--force"] }).success).toBe(false);
    await operation.handler({ title: "My Web App" }, context());

    expect(run).toHaveBeenCalledWith(
      [
        "create-script",
        "--type",
        "webapp",
        "--title",
        "My Web App",
        "--rootDir",
        "build",
      ],
      expect.any(Function),
    );
  });

  it("明示確認済みinputだけでforce pushする", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".clasp.json"),
      JSON.stringify({ scriptId: "script-123" }),
      "utf8",
    );
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const operation = operationById(
      createAppsScriptOperations({
        projectRoot,
        config: { type: "webapp" },
        clasp: { run },
      }),
      "apps.push",
    );

    expect(operation.input.safeParse({ confirmed: false }).success).toBe(false);
    expect(operation.input.safeParse({ confirmed: true }).success).toBe(true);
    await operation.handler({ confirmed: true }, context());

    expect(run).toHaveBeenCalledWith(["push", "--force"], expect.any(Function));
  });

  it("project未作成ではopenを拒否する", async () => {
    const projectRoot = await createProject();
    const run = vi.fn();
    const operation = operationById(
      createAppsScriptOperations({
        projectRoot,
        config: { type: "webapp" },
        clasp: { run } as ClaspRunner,
      }),
      "apps.open",
    );

    await expect(operation.handler({}, context())).rejects.toThrow(
      "Create or connect an Apps Script project first",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("壊れた.clasp.jsonを未作成として上書きしない", async () => {
    const projectRoot = await createProject();
    await writeFile(join(projectRoot, ".clasp.json"), "not-json", "utf8");
    const run = vi.fn();
    const operation = operationById(
      createAppsScriptOperations({
        projectRoot,
        config: { type: "webapp" },
        clasp: { run } as ClaspRunner,
      }),
      "apps.create",
    );

    await expect(
      operation.handler({ title: "My Web App" }, context()),
    ).rejects.toThrow("does not contain valid project settings");
    expect(run).not.toHaveBeenCalled();
  });
});

function operationById(
  operations: ReturnType<typeof createAppsScriptOperations>,
  id: string,
) {
  const operation = operations.find((candidate) => candidate.id === id);
  if (operation === undefined) throw new Error(`Operation not found: ${id}`);
  return operation;
}

function context() {
  return { log: vi.fn(), progress: vi.fn() };
}
