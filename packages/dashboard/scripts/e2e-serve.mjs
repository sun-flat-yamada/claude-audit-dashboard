// Serves every prepared profile with `vite preview` (same base path as GitHub Pages), one port
// each, from a single process. Started by Playwright's webServer.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { assertNotLive, BASE_PATH, PROFILES, portOf } from './e2e-profiles.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
assertNotLive(process.env);

const servers = [];
for (const profile of PROFILES) {
  const outDir = join(pkgRoot, '.e2e', 'profiles', profile.name);
  if (!existsSync(join(outDir, 'index.html'))) {
    console.error(
      `Profile ${profile.name} is not prepared; run \`pnpm test:e2e\` (or node scripts/e2e-prepare.mjs)`,
    );
    process.exit(1);
  }
  servers.push(
    await preview({
      root: pkgRoot,
      base: BASE_PATH,
      // 'mpa': a missing file answers 404 like GitHub Pages (the SPA fallback would answer index.html).
      appType: 'mpa',
      build: { outDir },
      preview: { host: '127.0.0.1', port: portOf(profile.name), strictPort: true, open: false },
      logLevel: 'error',
    }),
  );
}
console.log(
  `E2E preview servers ready: ${PROFILES.map((p) => `${p.name}:${portOf(p.name)}`).join(' ')}`,
);

const close = async () => {
  await Promise.all(servers.map((s) => s.close()));
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
