import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '@claude-audit/core';
import { consoleLogger } from '../infrastructure/runtime.js';
import { COMMANDS, usage } from './commands.js';
import { createContainer, type ContainerOptions } from './container.js';

/** Runs one command and returns the process exit code. */
export async function runCli(
  argv: readonly string[],
  options: ContainerOptions = {},
): Promise<number> {
  const [name, ...args] = argv;
  const command = name ? COMMANDS.get(name) : undefined;
  const logger = options.logger ?? consoleLogger;
  if (!command) {
    logger.info(usage());
    return name ? 2 : 0;
  }
  try {
    await command.run(await createContainer(options), args);
    return 0;
  } catch (error) {
    logger.error(errorMessage(error));
    return 1;
  }
}

/** Local runs read `.env` from the directory pnpm was started in; real environment variables win. */
function loadDotEnv(): void {
  const file = resolve(process.env.INIT_CWD ?? process.cwd(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotEnv();
  process.exitCode = await runCli(process.argv.slice(2));
}
