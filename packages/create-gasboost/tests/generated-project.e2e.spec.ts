import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PROFILES,
  type CapabilitySelection,
} from "../src/capabilities.js";
import { createProjectFiles } from "../src/generator.js";

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
      env: {
        ...process.env,
        CI: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

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

async function waitForHello({
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
          "Dev server exited before hello RPC became ready.",
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
      const response = await fetch(`${baseUrl}/__gasboost/hello`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: "{}",
      });

      const body = await response.text();

      lastResponse = `${response.status} ${body}`;

      if (response.ok) {
        expect(JSON.parse(body)).toEqual({
          message: "Hello from gasboost",
        });

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
      "Timed out waiting for hello RPC.",
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
  frontend,
}: {
  readonly cwd: string;
  readonly frontend: boolean;
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
    await waitForHello({
      baseUrl,
      running,
    });

    if (frontend) {
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

          await runCommand({
            cwd: temporaryRoot,

            args: [
              "install",
              "--frozen-lockfile=false",
              "--prefer-offline",
              "--reporter=append-only",
            ],
          });

          await runCommand({
            cwd: temporaryRoot,
            args: ["run", "typecheck"],
          });

          await runCommand({
            cwd: temporaryRoot,
            args: ["run", "build"],
          });

          if (capabilities.realtime) {
            await runCommand({
              cwd: temporaryRoot,
              args: ["run", "rules"],
            });
          }

          /*
           * Runtime contract:
           *
           * - Vite starts
           * - backend entry can be evaluated
           * - hello RPC is actually callable
           * - auth profiles do not accidentally protect hello
           * - database profiles can initialize locally
           */
          await verifyDev({
            cwd: temporaryRoot,
            frontend: capabilities.frontend,
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
