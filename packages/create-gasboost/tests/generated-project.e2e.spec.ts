import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("generated projects", { concurrent: false }, () => {
  it("defines exactly seven normalized profiles", () => {
    expect(CAPABILITY_PROFILES).toHaveLength(7);
  });

  it.each(profiles)(
    "$name installs, typechecks and builds",
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
});
