import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PROFILES,
  type CapabilitySelection,
} from "../src/capabilities.js";
import { createProjectFiles } from "../src/generator.js";
import { installFrontend } from "../src/registry.js";
import { runtimeContract } from "./runtime-contract.js";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

type RunningCommand = {
  readonly child: ChildProcess;
  readonly output: () => CommandResult;
};

function profileName(capabilities: CapabilitySelection): string {
  const enabled: string[] = [];

  if (capabilities.database) {
    enabled.push("database");
  }

  if (capabilities.authentication) {
    enabled.push("authentication");
  }

  if (capabilities.frontend) {
    enabled.push("frontend");
  }

  if (capabilities.realtime) {
    enabled.push("realtime");
  }

  return enabled.length === 0 ? "backend-only" : enabled.join("+");
}

async function runCommand({
  cwd,
  args,
}: {
  readonly cwd: string;
  readonly args: readonly string[];
}): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(pnpmCommand, [...args], {
      cwd,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        CI: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      try {
        if (process.platform !== "win32" && child.pid !== undefined)
          process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, 120_000);
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          [
            `Failed to start command: ${pnpmCommand} ${args.join(" ")}`,
            `cwd: ${cwd}`,
            "",
            String(error),
          ].join("\n"),
        ),
      );
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({
          stdout,
          stderr,
        });

        return;
      }

      reject(
        new Error(
          [
            `Command failed: ${pnpmCommand} ${args.join(" ")}`,
            `cwd: ${cwd}`,
            `exit code: ${String(code)}`,
            `signal: ${String(signal)}`,
            "",
            "--- stdout ---",
            stdout,
            "",
            "--- stderr ---",
            stderr,
          ].join("\n"),
        ),
      );
    });
  });
}

function startCommand({
  cwd,
  args,
}: {
  readonly cwd: string;
  readonly args: readonly string[];
}): RunningCommand {
  let stdout = "";
  let stderr = "";

  const child = spawn(pnpmCommand, [...args], {
    cwd,
    env: {
      ...process.env,
      CI: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });

  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return {
    child,

    output() {
      return {
        stdout,
        stderr,
      };
    },
  };
}

async function stopCommand(running: RunningCommand): Promise<void> {
  const { child } = running;

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const closePromise = once(child, "close").then(() => undefined);

  const pid = child.pid;

  try {
    if (process.platform !== "win32" && pid !== undefined) {
      process.kill(-pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    child.kill("SIGTERM");
  }

  await Promise.race([closePromise, delay(3_000)]);

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (process.platform !== "win32" && pid !== undefined) {
      process.kill(-pid, "SIGKILL");
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();

    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || typeof address === "string") {
        server.close();

        reject(new Error("Could not allocate a local port."));

        return;
      }

      const { port } = address;

      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolvePromise(port);
      });
    });
  });
}

async function waitForBackend({
  baseUrl,
  running,
}: {
  readonly baseUrl: string;
  readonly running: RunningCommand;
}): Promise<void> {
  const deadline = Date.now() + 20_000;

  let lastResponse = "";

  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) {
      const output = running.output();

      throw new Error(
        [
          "Dev server exited before backend dispatch became ready.",
          "",
          "--- stdout ---",
          output.stdout,
          "",
          "--- stderr ---",
          output.stderr,
        ].join("\n"),
      );
    }

    try {
      const response = await fetch(
        `${baseUrl}/__gasboost/__missing_handler__`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: "{}",
        },
      );

      const body = await response.text();

      lastResponse = `${response.status} ${body}`;

      if (response.status === 500 && body.includes("GASBOOST_RPC_ERROR_V1:")) {
        return;
      }
    } catch (error) {
      lastResponse = error instanceof Error ? error.message : String(error);
    }

    await delay(200);
  }

  const output = running.output();

  throw new Error(
    [
      "Timed out waiting for backend dispatch.",
      `Last response: ${lastResponse}`,
      "",
      "--- stdout ---",
      output.stdout,
      "",
      "--- stderr ---",
      output.stderr,
    ].join("\n"),
  );
}

async function verifyFrontend({
  baseUrl,
}: {
  readonly baseUrl: string;
}): Promise<void> {
  const response = await fetch(baseUrl);

  const html = await response.text();

  expect(response.ok).toBe(true);

  expect(html).toContain('id="root"');
  for (const path of [
    "src/frontend/main.tsx",
    "src/frontend/App.tsx",
    "src/frontend/style.css",
  ]) {
    const module = await fetch(new URL(path, baseUrl));
    expect(module.ok, await module.text()).toBe(true);
  }
  expect(html).not.toContain("<?!= __BOOTSTRAP__ ?>");
}

async function waitForConsoleUrl(running: RunningCommand): Promise<string> {
  const deadline = Date.now() + 20_000;

  const pattern = /Gasboost Console opened: (http:\/\/127\.0\.0\.1:\d+)/;

  while (Date.now() < deadline) {
    const output = running.output();

    const match = pattern.exec(output.stdout);

    if (match?.[1] !== undefined) {
      return match[1];
    }

    if (running.child.exitCode !== null) {
      throw new Error(
        [
          "Console process exited before opening.",
          "",
          "--- stdout ---",
          output.stdout,
          "",
          "--- stderr ---",
          output.stderr,
        ].join("\n"),
      );
    }

    await delay(100);
  }

  const output = running.output();

  throw new Error(
    [
      "Timed out waiting for Console URL.",
      "",
      "--- stdout ---",
      output.stdout,
      "",
      "--- stderr ---",
      output.stderr,
    ].join("\n"),
  );
}

async function verifyConsole({ cwd }: { readonly cwd: string }): Promise<void> {
  const running = startCommand({
    cwd,

    args: ["run", "console", "--no-browser"],
  });

  try {
    const url = await waitForConsoleUrl(running);

    const response = await fetch(url);

    const html = await response.text();

    expect(response.ok).toBe(true);

    expect(html).toContain("gasboost console");
  } finally {
    await stopCommand(running);
  }
}

async function verifyDev({
  cwd,
  capabilities,
}: {
  readonly cwd: string;
  readonly capabilities: CapabilitySelection;
}): Promise<void> {
  const port = await getAvailablePort();

  const baseUrl = `http://127.0.0.1:${port}`;

  const running = startCommand({
    cwd,

    args: [
      "run",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
  });

  try {
    await waitForBackend({
      baseUrl,
      running,
    });

    if (capabilities.authentication) {
      const challengeUrl = /Local bootstrap: (http:\/\/[^\s]+)/.exec(
        running.output().stdout,
      )?.[1];
      expect(challengeUrl).toBeTruthy();
      const token = new URL(challengeUrl!).searchParams.get("token");
      const initialized = await fetch(`${baseUrl}/__gasboost/initializeApp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { token } }),
      });
      expect(await initialized.json()).toEqual({ initialized: true });
    }

    if (capabilities.frontend) {
      await verifyFrontend({
        baseUrl,
      });
    }
  } finally {
    await stopCommand(running);
  }
}

async function writeGeneratedProject({
  directory,
  projectName,
  capabilities,
}: {
  readonly directory: string;
  readonly projectName: string;
  readonly capabilities: CapabilitySelection;
}): Promise<void> {
  const root = resolve(directory);

  const rootPrefix = `${root}${sep}`;

  const files = createProjectFiles({
    projectName,
    capabilities,
  });

  for (const file of files) {
    const destination = resolve(root, file.path);

    if (!destination.startsWith(rootPrefix)) {
      throw new Error(`Generated path escapes project root: ${file.path}`);
    }

    await mkdir(dirname(destination), {
      recursive: true,
    });

    await writeFile(destination, file.content, "utf8");
  }
}

const profiles = CAPABILITY_PROFILES.map((capabilities, index) => ({
  name: `${index + 1}. ${profileName(capabilities)}`,
  capabilities,
}));

describe(
  "generated projects",
  {
    concurrent: false,
  },
  () => {
    it("defines exactly seven normalized profiles", () => {
      expect(CAPABILITY_PROFILES).toHaveLength(7);
    });

    it.each(profiles)(
      "$name satisfies the generated project runtime contract",
      async ({ name, capabilities }) => {
        const temporaryRoot = await mkdtemp(
          join(tmpdir(), "create-gasboost-e2e-"),
        );

        const projectName = `gasboost-e2e-${name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}`;

        try {
          await writeGeneratedProject({
            directory: temporaryRoot,
            projectName,
            capabilities,
          });

          await installFrontend({
            targetDirectory: temporaryRoot,
            capabilities,
          });

          await runCommand({
            cwd: temporaryRoot,

            args: [
              "install",
              "--strict-peer-dependencies",
              "--frozen-lockfile=false",
              "--prefer-offline",
              "--reporter=append-only",
            ],
          });

          const installed = JSON.parse(
            await readFile(join(temporaryRoot, "package.json"), "utf8"),
          );
          if (!capabilities.authentication)
            for (const name of [
              "@gasboost/auth",
              "@gasboost/auth-client",
              "@gasboost/bootstrap",
            ])
              expect(installed.dependencies[name]).toBeUndefined();
          if (!capabilities.realtime)
            for (const name of [
              "firebase",
              "@gasboost/realtime-firebase",
              "@gasboost/replica",
            ])
              expect(installed.dependencies[name]).toBeUndefined();
          if (!capabilities.database)
            expect(
              installed.dependencies["@gasboost/sheetorm"],
            ).toBeUndefined();

          await runCommand({
            cwd: temporaryRoot,
            args: ["run", "typecheck"],
          });

          await runCommand({
            cwd: temporaryRoot,
            args: ["run", "build"],
          });

          const built = await readFile(
            join(temporaryRoot, "dist/main.js"),
            "utf8",
          );
          expect(built).not.toContain("function hello()");
          expect(
            JSON.parse(
              await readFile(
                join(temporaryRoot, "dist/appsscript.json"),
                "utf8",
              ),
            ),
          ).toHaveProperty("runtimeVersion", "V8");
          if (capabilities.frontend) {
            const html = await readFile(
              join(temporaryRoot, "dist/index.html"),
              "utf8",
            );
            expect(html).not.toContain('src="/src/frontend/main.tsx"');
            if (capabilities.authentication)
              expect(html).toContain("<?!= __BOOTSTRAP__ ?>");
          }
          if (capabilities.realtime) {
            const rules = JSON.parse(
              await readFile(
                join(temporaryRoot, "database.rules.json"),
                "utf8",
              ),
            );
            expect(rules.rules).toMatchObject({
              ".read": false,
              ".write": false,
              syncVersions: { ".read": "auth != null" },
            });
          }

          // Zero-test output is checked before adding generator-owned test fixtures.
          await runCommand({ cwd: temporaryRoot, args: ["test"] });
          expect(await readdir(join(temporaryRoot, "tests"))).toEqual([
            "mocks",
          ]);
          await writeFile(
            join(temporaryRoot, "tests", "foundation.test.ts"),
            runtimeContract(capabilities),
          );
          if (capabilities.database && !capabilities.authentication) {
            await writeFile(
              join(temporaryRoot, "src/shared/tables.ts"),
              `import { defineTable } from "@gasboost/table";
import { z } from "zod";
export const tables = [defineTable({ name: "fixture", schema: z.object({ id: z.string(), value: z.string() }), primaryKey: "id" })] as const;`,
            );
          }
          await runCommand({ cwd: temporaryRoot, args: ["test"] });
          // Remove fixtures before checking the unchanged application's dev server.
          await rm(join(temporaryRoot, "tests", "foundation.test.ts"));
          if (capabilities.database && !capabilities.authentication) {
            const original = createProjectFiles({
              projectName,
              capabilities,
            }).find((file) => file.path === "src/shared/tables.ts")!;
            await writeFile(
              join(temporaryRoot, original.path),
              original.content,
            );
          }

          /*
           * Runtime contract:
           *
           * - Vite starts
           * - backend entry can be evaluated
           * - missing handlers reach the actual dispatcher
           * - database profiles can initialize locally
           */
          await verifyDev({
            cwd: temporaryRoot,
            capabilities,
          });

          /*
           * Project-management contract:
           *
           * The generated project can open the
           * Gasboost Console immediately.
           */
          await verifyConsole({
            cwd: temporaryRoot,
          });
        } catch (error) {
          throw new Error(
            [
              `Generated project verification failed: ${name}`,
              "",
              `Capabilities: ${JSON.stringify(capabilities, null, 2)}`,
              "",
              error instanceof Error ? error.message : String(error),
            ].join("\n"),
          );
        } finally {
          await rm(temporaryRoot, {
            recursive: true,
            force: true,
          });
        }
      },
    );
  },
);
