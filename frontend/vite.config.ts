import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import os from 'os';

const DEFAULT_API_PORT = 3333;

// 与 CLI 端口优先级保持一致：CLAUDE_SWITCH_PORT > serve-config.json > 3333
function resolveApiPort(): number {
  const envPort = process.env.CLAUDE_SWITCH_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
  }
  const baseDir = process.env.CLAUDE_SWITCH_DIR || path.join(os.homedir(), '.claude-switch');
  try {
    const config = JSON.parse(fs.readFileSync(path.join(baseDir, 'serve-config.json'), 'utf8'));
    const port = config?.port;
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  } catch {
    // 配置文件不存在或损坏时使用默认端口
  }
  return DEFAULT_API_PORT;
}

const apiPort = resolveApiPort();

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
