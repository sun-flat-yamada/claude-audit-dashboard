import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '@claude-audit/core';
import { consoleLogger } from '../infrastructure/runtime.js';
import { COMMANDS, usage } from './commands.js';
import { createContainer, type ContainerOptions } from './container.js';

/** Extracts the global `--capture-raw <dir>` flag so every command accepts it. */
export function extractCaptureRaw(argv: readonly string[]): { args: string[]; dir?: string } {
  const index = argv.indexOf('--capture-raw');
  if (index < 0) return { args: [...argv] };
  const dir = argv[index + 1];
  if (!dir || dir.startsWith('--')) throw new Error('--capture-raw requires a directory');
  return { args: argv.filter((_, i) => i !== index && i !== index + 1), dir };
}

/** Runs one command and returns the process exit code. */
export async function runCli(
  argv: readonly string[],
  options: ContainerOptions = {},
): Promise<number> {
  const logger = options.logger ?? consoleLogger;
  let extracted: ReturnType<typeof extractCaptureRaw>;
  try {
    extracted = extractCaptureRaw(argv);
  } catch (error) {
    logger.error(errorMessage(error));
    return 2;
  }
  const [name, ...args] = extracted.args;
  const command = name ? COMMANDS.get(name) : undefined;
  if (!command) {
    logger.info(usage());
    return name ? 2 : 0;
  }
  try {
    const captureRawDir = extracted.dir ?? options.captureRawDir;
    await command.run(await createContainer({ ...options, captureRawDir }), args);
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
