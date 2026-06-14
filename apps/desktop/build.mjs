import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, 'dist');
const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

const entries = [
  { in: join(here, 'src/main/index.ts'), out: 'main' },
  { in: join(here, 'src/preload/index.ts'), out: 'preload' },
  { in: join(here, 'src/picker/picker-preload.ts'), out: 'picker-preload' },
];

const browserEntry = {
  entryPoints: [join(here, 'src/picker/picker.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: join(outdir, 'picker.js'),
  sourcemap: true,
};

mkdirSync(outdir, { recursive: true });

async function build() {
  for (const e of entries) {
    const cfg = {
      ...common,
      entryPoints: [e.in],
      outfile: join(outdir, `${e.out}.cjs`),
    };
    if (watch) await (await esbuild.context(cfg)).watch();
    else await esbuild.build(cfg);
  }
  if (watch) await (await esbuild.context(browserEntry)).watch();
  else await esbuild.build(browserEntry);

  // 静态资源
  cpSync(join(here, 'src/picker/picker.html'), join(outdir, 'picker.html'));
  cpSync(join(here, 'resources/tray-icon.png'), join(outdir, 'tray-icon.png'));
  // 生产 renderer：拷贝 web 构建产物
  cpSync(join(here, '../web/dist'), join(outdir, 'renderer'), {
    recursive: true,
  });
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
