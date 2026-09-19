#!/usr/bin/env node

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  assertEmptyProjectDirectory,
  writeProjectFiles,
} from "./filesystem.js";
import { createProjectFiles } from "./generator.js";
import { projectNameFromTarget } from "./projectName.js";
import { promptCapabilities } from "./prompts.js";

const exitCode = await run(process.argv.slice(2));

process.exitCode = exitCode;

async function run(args: readonly string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        help: {
          type: "boolean",
          short: "h",
        },
      },
      allowPositionals: true,
      strict: true,
    });

    if (values.help === true) {
      printHelp();
      return 0;
    }

    if (positionals.length > 1) {
      throw new Error("Only one target directory can be specified.");
    }

    const targetDirectory = resolve(positionals[0] ?? "gasboost-app");

    /*
     * Fail before asking capability questions when the target is
     * already occupied.
     */
    await assertEmptyProjectDirectory(targetDirectory);

    const projectName = projectNameFromTarget(targetDirectory);

    const capabilities = await promptCapabilities();

    const files = createProjectFiles({
      projectName,
      capabilities,
    });

    await writeProjectFiles({
      targetDirectory,
      files,
    });

    console.log("");
    console.log(`Created ${projectName} in ${targetDirectory}`);
    console.log("");
    console.log("Next steps:");
    console.log(`  cd ${JSON.stringify(targetDirectory)}`);
    console.log("  pnpm install");
    console.log("  pnpm dev");
    console.log("");
    console.log("Open the project console with:");
    console.log("  pnpm console");

    if (capabilities.realtime) {
      console.log("");
      console.log("Generate Firebase RTDB Security Rules with:");
      console.log("  pnpm rules");
    }

    return 0;
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    return 1;
  }
}

function printHelp(): void {
  console.log(`create-gasboost

Usage:
  create-gasboost [directory]

Examples:
  create-gasboost my-app
  create-gasboost

The generator asks only about application capabilities:
  Database? (Sheets)
  Authentication?
  Frontend? (React)
  Realtime? (Firebase RTDB)
`);
}
