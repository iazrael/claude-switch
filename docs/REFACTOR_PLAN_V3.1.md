# claude-switch v3.1 重构计划 (TypeScript + ESM)

## 1. 架构与目标概述
本项目目前为 v3.0.0 (CommonJS + 原生 JS)。本次重构将版本升级至 **3.1.0**，目标是全面迁移至 **TypeScript** 并完全符合 **ESM (ECMAScript Modules)** 规范。

### 核心约束
- **包管理器**: 全局采用 `pnpm`。
- **模块规范**: 强制 ESM，`package.json` 中声明 `"type": "module"`。
- **动态导入策略**: 原则上使用静态 `import`。但对于包含副作用或显著影响启动性能的模块（如 `lib/serve` 守护进程启动），保留按需加载优势，使用顶层 `await import(...)` 替代原来的按需 `require`。
- **全链路 TS**: 业务逻辑 (`lib/`)、入口文件 (`index.ts`, `server.ts`)、配置文件 (`vitest.config.ts`, `tsup.config.ts`) 和测试代码 (`tests/`) 全部改写为 TypeScript。前端 (`public/`) 保持原生 JS 不变，不纳入构建流程。

---

## 2. 阶段一：工程配置与依赖验证

**1. 初始化与基础更新**
- 修改 `package.json`: 
  - `"version": "3.1.0"`
  - 增加 `"type": "module"`
  - 将入口 `"bin": { "claude-switch": "./dist/index.js" }` 指向编译后目录。

**2. 依赖兼容性验证与升级**
- 扫描并确认依赖的 ESM 兼容性。
- 将 `chalk@4` 升级为 `chalk@5` (纯 ESM)。
- 确认 `commander`, `fs-extra` 双模式兼容。
- 确认 `inquirer`, `proper-lockfile`, `express` 等 CJS 库的默认导入行为 (`import express from 'express'`)。
- 安装 TypeScript 及打包/类型依赖：
  ```bash
  pnpm add -D typescript @types/node @types/fs-extra @types/express @types/cors @types/inquirer @types/proper-lockfile tsup
  ```

**3. TypeScript 配置 (`tsconfig.json`)**
- 必须严格遵循 ESM 解析策略：
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "outDir": "./dist",
      "rootDir": "./",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true
    },
    "include": ["lib/**/*", "index.ts", "server.ts", "tests/**/*", "vitest.config.ts", "tsup.config.ts", "env.d.ts"]
  }
  ```

---

## 3. 阶段二：类型系统设计与声明

为了保证代码的类型安全，首先提取项目核心类型：

**1. 环境变量类型声明 (`env.d.ts`)**
```typescript
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CLAUDE_SWITCH_DIR?: string;
      CLAUDE_SETTINGS_PATH?: string;
      CLAUDE_SWITCH_PORT?: string;
    }
  }
}
export {};
```

**2. 业务与加密核心类型 (`lib/types.ts`)**
- 定义 `ClaudeEnv` (包含 `OPUS`, `SONNET`, `HAIKU`, `BASE_URL`, `AUTH_TOKEN`)。
- 定义 `Profile` 和 `ProfileData` 接口。
- 定义 `DiffResult`、`ActionLog` 等交互类型。
- 明确加密相关类型：
```typescript
export interface EncryptedData {
  iv: string;         // base64
  ciphertext: string; // base64
}

export interface CryptoConfig {
  algorithm: 'aes-256-cbc';
  keyLength: 32;
  ivLength: 16;
}
```

---

## 4. 阶段三：核心逻辑与文件系统改造 (ESM 适配)

**1. 导入导出改造**
- 将所有的 `require()` 替换为 `import`。将 `module.exports` 替换为 `export` / `export default`。
- **惰性加载**：将 `index.ts` 中涉及 `serve` 命令的动态 `require` 改为 `const serve = await import('./lib/serve.js')`（ESM 编译后需带扩展名或由构建工具处理）。

**2. 解决 ESM 下的路径问题**
在 ESM 中没有全局的 `__dirname` 和 `__filename`，对于 `lib/config.ts` 中的路径解析，需进行如下改造：
```typescript
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

**3. JSON 文件的导入**
ESM 中导入 `package.json` 需要使用导入断言或原生 `fs` 读取以增加兼容性：
```typescript
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
```

---

## 5. 阶段四：测试代码与构建脚本配套修改

**1. 构建配置 (`tsup.config.ts`)**
增加完整的 tsup 配置文件，处理多入口和打包需求：
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.ts', 'server.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  minify: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  external: ['express', 'chalk', 'commander', 'inquirer', 'fs-extra', 'proper-lockfile', 'cors']
});
```

**2. 测试框架与 Mock 语法适配**
- 将 `vitest.config.js` 重命名为 `vitest.config.ts`。
  ```typescript
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      pool: 'forks',
      include: ['tests/**/*.test.ts']
    }
  });
  ```
- **ESM Mock 语法检查**：在 ESM 下，`vi.mock()` 必须被提升至模块顶层。检查 `tests/` 中的用例，将所有动态/行内的 mock 移至顶层，并使用 `vi.importActual()` 替代需要实际实现的模块。

**3. Scripts 脚本更新**
```json
"scripts": {
  "build": "tsup",
  "start": "node dist/server.js",
  "cli": "node dist/index.js",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

---

## 6. 阶段五：实施步骤

1. **环境准备与依赖检查**：新建 Git 分支 (`v3.1-ts-esm`)。执行 `pnpm install` 安装 TypeScript 及 ESM 兼容依赖 (如 `chalk@5`)。配置 `tsconfig.json` 和 `env.d.ts`。
2. **逐模块迁移与编译**：避免大爆炸式迁移。按依赖顺序逐个改写为 `.ts` (如 `config` -> `crypto-utils` -> `logger` -> `profile-manager`)。每迁移一个模块，立即运行 `npx tsc --noEmit` 验证类型。
3. **顶层联调与动态导入处理**：迁移 `server.ts` 和 `index.ts`。重点重构 `index.ts` 中的命令动态加载 (`await import`)，确保副作用隔离。
4. **测试用例修复与 ESM Mock 适配**：将 `tests/*.js` 改为 `.ts`。修复路径宏 (`__dirname`)，将 `vi.mock` 移至文件顶层，执行 `pnpm test` 保证所有业务逻辑分支绿灯。
5. **打包与最终交付验证**：
   - 运行 `pnpm build`，检查 `dist/` 产物。
   - 验证独立启动能力：`node dist/index.js list`。
   - 重点验证守护进程能力：确保 `serve` 分离进程时 (`spawn`) 指向的是编译后的 `dist/server.js` 路径，且前端静态文件 (`public/`) 能被正确伺服。
