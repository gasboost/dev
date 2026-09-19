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

  it("project rootのsource manifestをactual stateとして検出する", async () => {
    const projectRoot = await createProject();
    await mkdir(join(projectRoot, "dist"));
    await writeFile(
      join(projectRoot, ".clasp.json"),
      JSON.stringify({ scriptId: "script-123", rootDir: "dist" }),
      "utf8",
    );
    await writeFile(join(projectRoot, "appsscript.json"), "{}", "utf8");
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

  it("rootDir配下だけにmanifestがあってもsource manifestとしては検出しない", async () => {
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
    ).resolves.toMatchObject({ rootDir: "dist", manifestExists: false });
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

  it("明示確認済みinputだけでbuild後にforce pushする", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".clasp.json"),
      JSON.stringify({ scriptId: "script-123" }),
      "utf8",
    );
    const calls: string[] = [];
    const build = vi.fn(async () => {
      calls.push("build");
      await mkdir(join(projectRoot, "dist"));
      await writeFile(join(projectRoot, "dist", "appsscript.json"), "{}", "utf8");
      return { exitCode: 0, stdout: "built", stderr: "" };
    });
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const operation = operationById(
      createAppsScriptOperations({
        projectRoot,
        config: { type: "webapp" },
        clasp: { run },
        build: { run: build },
      }),
      "apps.push",
    );

    expect(operation.input.safeParse({ confirmed: false }).success).toBe(false);
    expect(operation.input.safeParse({ confirmed: true }).success).toBe(true);
    expect(operation.input.safeParse({ confirmed: true, command: "rm -rf dist" }).success).toBe(false);
    await operation.handler({ confirmed: true }, context());

    expect(build).toHaveBeenCalledWith(expect.any(Function));
    expect(run).toHaveBeenCalledWith(["push", "--force"], expect.any(Function));
    expect(calls).toEqual(["build"]);
    await expect(readFile(join(projectRoot, "dist", "appsscript.json"), "utf8")).resolves.toBe("{}");
  });

  it("build失敗時はforce pushしない", async () => {
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
        build: {
          run: vi.fn(async () => ({
            exitCode: 1,
            stdout: "",
            stderr: "compile failed",
          })),
        },
      }),
      "apps.push",
    );

    await expect(operation.handler({ confirmed: true }, context())).rejects.toThrow(
      "Build failed: compile failed",
    );
    expect(run).not.toHaveBeenCalledWith(["push", "--force"], expect.any(Function));
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

  it("接続済みScript IDのeditorを開く", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".clasp.json"),
      JSON.stringify({ scriptId: "script-123" }),
      "utf8",
    );
    const browserOpener = vi.fn(async () => undefined);
    const operation = operationById(
      createAppsScriptOperations({
        projectRoot,
        config: { type: "webapp" },
        clasp: { run: vi.fn() } as ClaspRunner,
        browserOpener,
      }),
      "apps.open",
    );

    await expect(operation.handler({}, context())).resolves.toEqual({ opened: true });
    expect(browserOpener).toHaveBeenCalledWith(
      "https://script.google.com/home/projects/script-123/edit",
    );
  });

  it("deployment createのdescriptionは空文字でも省略でも有効", async () => {
    const projectRoot = await createProject();
    await writeFile(
      join(projectRoot, ".clasp.json"),
      JSON.stringify({ scriptId: "script-123" }),
      "utf8",
    );
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "Deployment ID: dep-123", stderr: "" }));
    const operation = operationById(
      createAppsScriptOperations({
        projectRoot,
        config: { type: "webapp" },
        clasp: { run },
      }),
      "apps.deployment.create",
    );

    expect(operation.input.safeParse({}).success).toBe(true);
    expect(operation.input.safeParse({ description: "" }).success).toBe(true);
    await operation.handler({ description: "" }, context());

    expect(run).toHaveBeenCalledWith(["create-deployment"], expect.any(Function));
  });

  it("deployment updateはclasp 3.4.1の位置引数でdeployment IDを渡す", async () => {
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
      "apps.deployment.update",
    );

    await operation.handler({ deploymentId: "dep-123" }, context());

    expect(run).toHaveBeenCalledWith(["update-deployment", "dep-123"], expect.any(Function));
    expect(run).not.toHaveBeenCalledWith(
      ["update-deployment", "--deploymentId", "dep-123"],
      expect.any(Function),
    );
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
