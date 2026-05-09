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