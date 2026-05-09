// 环境变量
export interface ClaudeEnv {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

// 套餐
export interface Profile {
  env: ClaudeEnv;
}

// 套餐数据 (API 响应)
export interface ProfileData {
  active: string | null;
  profiles: Record<string, Profile>;
  mismatch: boolean;
}

// 当前环境响应
export interface CurrentEnvResponse {
  env: ClaudeEnv;
  activeProfile: string | null;
  mismatch: boolean;
}

// 预设模板
export interface PresetTemplate {
  label: string;
  baseUrl: string;
  opus: string;
  sonnet: string;
  haiku: string;
}

export type Presets = Record<string, PresetTemplate>;

// 备份条目
export interface BackupItem {
  fileName: string;
  reason?: string;
}

export type BackupType = 'settings' | 'profiles';

// Diff 变化
export interface DiffChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

// Profile Diff
export interface ProfileDiffChange {
  profile: string;
  changes: DiffChange[];
}

export interface ProfileDiff {
  added: string[];
  removed: string[];
  changed: ProfileDiffChange[];
  unchanged: string[];
}

// Settings Diff
export interface SettingsDiff {
  added?: string[];
  removed?: string[];
  changed?: DiffChange[];
  unchanged?: string[];
}

// 日志条目
export interface LogEntry {
  date: string;
  content: string;
}