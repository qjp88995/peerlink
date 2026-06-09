import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const traefikPort = Number(env.TRAEFIK_PORT ?? 8894);
  const insideDocker = env.RUNNING_IN_DOCKER === '1';

  return {
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      // 容器内经 Traefik 反代、或从局域网其它设备访问时，Host 头不是
      // localhost，Vite 的 host 检查会拦截（403）。这里放开。
      allowedHosts: insideDocker ? true : undefined,
      hmr: insideDocker ? { clientPort: traefikPort } : true,
      proxy: insideDocker
        ? undefined
        : {
            // 原生（非 docker）开发时把 /signal 代理到本地信令服务
            '/signal': {
              target: env.VITE_SIGNAL_TARGET ?? 'ws://localhost:3001',
              ws: true,
              changeOrigin: true,
            },
          },
    },
  };
});
