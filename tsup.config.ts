import { defineConfig } from 'tsup';
import fs from 'fs-extra';

export default defineConfig({
  entry: ['index.ts', 'server.ts'],
  format: ['esm'],
  target: 'node24',
  clean: true,
  minify: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  external: ['express', 'chalk', 'commander', 'inquirer', 'fs-extra', 'proper-lockfile', 'cors'],
  async onSuccess() {
    await fs.copy('public', 'dist/public');
    await fs.copy('package.json', 'dist/package.json');
  }
});