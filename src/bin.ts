#!/usr/bin/env node

import { Cli } from "./cli/Cli.js";
import { CommandRouter } from "./cli/CommandRouter.js";
import { GasboostConfigLoader } from "./config/GasboostConfigLoader.js";
import { ModuleLoader } from "./module/ModuleLoader.js";
import { RtdbRulesCommand } from "./rtdb/RtdbRulesCommand.js";
import { RtdbRulesWriter } from "./rtdb/RtdbRulesWriter.js";

const projectRoot = process.cwd();

const moduleLoader = new ModuleLoader(projectRoot);

const configLoader = new GasboostConfigLoader({
  projectRoot,
  moduleLoader,
});

const writer = new RtdbRulesWriter(projectRoot);

const rtdbRulesCommand = new RtdbRulesCommand({
  configLoader,
  moduleLoader,
  writer,
});

const commandRouter = new CommandRouter(rtdbRulesCommand);

const cli = new Cli(commandRouter);

process.exitCode = await cli.run(process.argv.slice(2));
