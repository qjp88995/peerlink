// 生产打包：把 signaling 及其工作区依赖（@peerlink/protocol 的 TS 源码）打成
// 单个 ESM 文件 dist/server.mjs。这样生产镜像用纯 node 即可运行，绕开两个坑：
//   1. 编译产物里的无扩展名相对导入（dev 靠 tsx 解析，纯 node 不认）；
//   2. @peerlink/protocol 的 exports.import 指向 .ts 源码（为 dev 免构建而设）。
// npm 运行时依赖（pino/ws/zod 等）保持 external，由镜像内的 node_modules 提供，
// 避免 esbuild 把 pino 的动态 require 打进来导致运行时报错。
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8')
);
const external = Object.keys(pkg.dependencies ?? {}).filter(
  (dep) => !dep.startsWith('@peerlink/')
);

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: 'dist/server.mjs',
  external,
});
