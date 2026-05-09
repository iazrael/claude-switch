import { defineConfig } from 'tsup';
import fs from 'fs-extra';

export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  minify: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  external: ['express', 'chalk', 'commander', 'inquirer', 'fs-extra', 'proper-lockfile', 'cors'],
  async onSuccess() {
    // 只复制 package.json，前端由 Vite 构建到 dist/public/
    await fs.copy('package.json', 'dist/package.json');
  }
});