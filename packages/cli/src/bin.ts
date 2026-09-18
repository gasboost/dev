#!/usr/bin/env node

import { loadGasboostConfig, ModuleLoader } from "@gasboost/config";
import { Cli } from "./cli/Cli.js";
import { CommandRouter } from "./cli/CommandRouter.js";
import { ConsoleOpenCommand } from "./console/ConsoleOpenCommand.js";
import { RtdbRulesCommand } from "./rtdb/RtdbRulesCommand.js";
import { RtdbRulesWriter } from "./rtdb/RtdbRulesWriter.js";

const projectRoot = process.cwd();

const moduleLoader = new ModuleLoader(projectRoot);

const writer = new RtdbRulesWriter(projectRoot);

const rtdbRulesCommand = new RtdbRulesCommand({
  loadConfig: () => loadGasboostConfig({ projectRoot }),
  moduleLoader,
  writer,
});

const commandRouter = new CommandRouter({
  consoleOpenCommand: new ConsoleOpenCommand(projectRoot),
  rtdbRulesCommand,
});

const cli = new Cli(commandRouter);

process.exitCode = await cli.run(process.argv.slice(2));
