# GEMINI.md — claude-switch Project Instructions

## Project Overview

`claude-switch` is a specialized tool (v3.0.0) designed to manage and switch between different "profiles" (configurations) for Claude Code. It allows users to quickly swap between various Anthropic API-compatible providers (like Aliyun DashScope, Volcengine, ZhipuAI, DeepSeek) by updating the environment variables in Claude Code's `settings.json`.

The project provides:
- **CLI Interface**: Interactive terminal-based management.
- **Web Interface**: A mobile-friendly responsive UI (Express-based).
- **Security**: AES-256-CBC encryption for API tokens, with keys derived from unique machine and hardware characteristics.
- **Reliability**: Automatic backups before any write operation and detailed action logging.
- **Daemon Management**: A built-in `serve` command to manage the Web service as a background process.

## Architecture and Core Components

- **CLI (`index.js`)**: Uses `commander` and `inquirer` for the terminal interface.
- **Web Server (`server.js`)**: An Express server providing RESTful APIs for the frontend.
- **Frontend (`public/`)**: A zero-dependency Single Page Application (SPA) using vanilla JS, CSS, and HTML.
- **Logic Layer (`lib/`)**:
    - `profile-manager.js`: Core business logic (CRUD for profiles, switching, migration, and mismatch detection).
    - `crypto-utils.js`: Hardware-bound AES encryption/decryption logic.
    - `backup.js`: File-level backup and restoration with reason-tagging.
    - `serve.js`: Process management for the Web server (PID tracking, daemonization, log rotation).
    - `config.js`: Path resolution supporting overrides via environment variables.
    - `logger.js`: Persistent action logs.
    - `diff.js`: JSON comparison tool with sensitive data masking.

## Key Configuration & Data Paths

- **Data Directory**: Default is `~/.claude-switch`, can be overridden by `CLAUDE_SWITCH_DIR`.
- **Profiles**: `~/.claude-switch/profiles.json` (Sensitive fields are encrypted).
- **Claude Settings**: Default is `~/.claude/settings.json`, can be overridden by `CLAUDE_SETTINGS_PATH`.
- **Backups**: `~/.claude-switch/backups/`.
- **Logs**: `~/.claude-switch/logs/`.
- **Service Port**: Default is `3333`, can be overridden by `CLAUDE_SWITCH_PORT`.

## Development Workflows

### Setup
```bash
pnpm install
pnpm link # Makes 'claude-switch' command available globally
```

### Running Commands
- **CLI Mode**: `node index.js` (interactive) or `node index.js <command>`.
- **Web Mode (Foreground)**: `node index.js serve --foreground`.
- **Web Mode (Background)**: `node index.js serve` (starts daemon).
- **Stop Web Service**: `node index.js serve stop`.
- **Status Check**: `node index.js serve status`.

### Testing
- **Run all tests**: `pnpm test` (Uses Vitest with `forks` pool to isolate environment variable/file system side effects).
- **Watch mode**: `pnpm test:watch`.

## Technical Conventions & Guidelines

- **Module System**: Strictly **CommonJS** (`require`/`module.exports`). No ESM.
- **Async Operations**: Use `async/await` for all I/O.
- **Error Handling**: Throw `Error` with descriptive Chinese messages in the logic layer; catch and return as JSON `{ error }` in the API layer.
- **Security Protocols**:
    - Never expose raw API tokens in logs or API responses (use masking: `••••••••`).
    - Profiles are written with `0o600` permissions.
    - Sensitive fields (e.g., `ANTHROPIC_AUTH_TOKEN`) must be encrypted before saving to `profiles.json`.
- **Data Integrity**: 
    - Use `proper-lockfile` via `withLock` in `profile-manager.js` for all writes to `profiles.json`.
    - Always call `backupFile` before modifying `profiles.json` or `settings.json`.
- **Model Layering**: Claude Code expects three model tiers: `OPUS` (Complex), `SONNET` (Daily), and `HAIKU` (Fast). Ensure all three are handled in profile definitions.
- **UI Consistency**: Maintain the Dark Mode theme in `styles.css` and use native JS for interactivity in `app.js`.

## Instruction Overrides (IMPORTANT)

- **Testing**: When adding features or fixing bugs, always run `pnpm test` to ensure no regressions in process management or encryption logic.
- **Subagents**: If performing complex refactoring or batch operations, use `@generalist`.
- **Verification**: After implementation, verify both CLI and Web interfaces if the change impacts shared logic.
