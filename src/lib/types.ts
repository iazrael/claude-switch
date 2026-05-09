export interface EncryptedData {
  iv: string;
  ciphertext: string;
}

export interface CryptoConfig {
  algorithm: 'aes-256-cbc';
  keyLength: 32;
  ivLength: 16;
}

export interface ClaudeEnv {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

// 允许扩展的环境变量类型（用于 settings.json 中可能存在的其他字段）
export interface ExtendedEnv extends ClaudeEnv {
  [key: string]: string | undefined;
}

export interface Profile {
  env: ClaudeEnv;
}

export interface ProfileData {
  active: string;
  profiles: Record<string, Profile>;
}

export interface DiffResult {
  added: string[];
  removed: string[];
  changed: { profile: string; changes: DiffChange[] }[];
  unchanged: string[];
  profiles?: Record<string, Profile>;
}

export interface DiffChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ActionLog {
  action: string;
  detail: string;
  timestamp: string;
}

// settings.json 结构
export interface SettingsJson {
  env?: ExtendedEnv;
  [key: string]: unknown;
}

// 预设模板结构
export interface PresetTemplate {
  label: string;
  baseUrl: string;
  opus: string;
  sonnet: string;
  haiku: string;
}

// PID 信息结构
export interface PidInfo {
  pid: number;
  port: number;
  startedAt: string;
}
