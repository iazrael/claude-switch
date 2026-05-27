import { useState, useEffect, useCallback } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { useProfiles } from './hooks/useProfiles';
import { useCurrentEnv } from './hooks/useCurrentEnv';
import { usePresets } from './hooks/usePresets';
import { useBackups } from './hooks/useBackups';
import { useLogs } from './hooks/useLogs';
import { Toast } from './components/Toast';
import { DiffTable } from './components/DiffTable';
import { ProfileItem } from './components/ProfileItem';
import { BackupItem } from './components/BackupItem';
import { CustomDialog } from './components/CustomDialog';
import styles from './styles/App.module.css';
import type { BackupType, ProfileDiff, SettingsDiff, ClaudeEnv } from './types/api';

function AppContent() {
  const { toast, showToast, editingProfile, setEditingProfile } = useAppContext();
  const { profiles, active, mismatch, load: loadProfiles, switchTo, add, update, remove, clone } = useProfiles();
  const { env, activeProfile, mismatch: envMismatch, load: loadCurrentEnv } = useCurrentEnv();
  const { presets } = usePresets();

  // Dialog state
  const [dialogConfig, setDialogConfig] = useState<{
    isOpen: boolean;
    type: 'prompt' | 'confirm';
    title: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
    intent?: 'primary' | 'danger' | 'warning';
    onConfirm: (val?: string) => void;
    onClose: () => void;
  } | null>(null);

  const showConfirm = useCallback((title: string, message: string, intent: 'primary' | 'danger' | 'warning' = 'primary', confirmText = '确认') => {
    return new Promise<boolean>((resolve) => {
      setDialogConfig({
        isOpen: true,
        type: 'confirm',
        title,
        message,
        confirmText,
        intent,
        onConfirm: () => {
          setDialogConfig(null);
          resolve(true);
        },
        onClose: () => {
          setDialogConfig(null);
          resolve(false);
        }
      });
    });
  }, []);

  const [backupType, setBackupType] = useState<BackupType>('settings');
  const { backups, load: loadBackups, restore, preview } = useBackups(backupType);

  // Active Selected Backup for Inline Diff Preview
  const [activeBackupFile, setActiveBackupFile] = useState<string>('');
  const [activeBackupDiff, setActiveBackupDiff] = useState<ProfileDiff | SettingsDiff | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState<boolean>(false);

  const { logs, load: loadLogs } = useLogs();
  const [logDate, setLogDate] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'workspace' | 'backups' | 'logs'>('workspace');

  // Form state
  const [formName, setFormName] = useState('');
  const [formToken, setFormToken] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formOpus, setFormOpus] = useState('');
  const [formSonnet, setFormSonnet] = useState('');
  const [formHaiku, setFormHaiku] = useState('');
  const [formPreset, setFormPreset] = useState('');

  // Initial load
  useEffect(() => {
    loadProfiles();
    loadCurrentEnv();
  }, [loadProfiles, loadCurrentEnv]);

  // Load diagnostic data when tabs change
  useEffect(() => {
    if (activeTab === 'backups') {
      loadBackups().catch(() => {}); // 切换Tab时静默加载备份，加载失败会在备份列表展示“无可用备份”及重试按钮，不打断用户
      setActiveBackupFile('');
      setActiveBackupDiff(null);
    } else if (activeTab === 'logs') {
      loadLogs(logDate).catch(() => {}); // 切换Tab时静默加载日志，加载失败会在日志列表展示“暂无日志”及检索按钮，不打断用户
    }
  }, [activeTab, loadBackups, loadLogs, logDate]);

  // Parser to identify log levels for color-coding
  const parseLogLevel = useCallback((line: string) => {
    const l = line.toUpperCase();
    if (l.includes('ERROR') || l.includes('FAIL') || l.includes('EXCEPTION')) {
      return styles.logError;
    }
    if (l.includes('WARN') || l.includes('⚠️')) {
      return styles.logWarn;
    }
    return styles.logInfo;
  }, []);

  // Apply preset template
  const applyPreset = useCallback((key: string) => {
    const p = presets[key];
    if (!p) return;
    setFormBaseUrl(p.baseUrl);
    setFormOpus(p.opus);
    setFormSonnet(p.sonnet);
    setFormHaiku(p.haiku);
  }, [presets]);

  // Clear form
  const clearForm = useCallback(() => {
    setEditingProfile(null);
    setFormName('');
    setFormToken('');
    setFormBaseUrl('');
    setFormOpus('');
    setFormSonnet('');
    setFormHaiku('');
    setFormPreset('');
  }, [setEditingProfile]);

  // Create new profile
  const handleCreateNew = useCallback(() => {
    setEditingProfile(null);
    setFormName('');
    setFormToken('');
    setFormBaseUrl('');
    setFormOpus('');
    setFormSonnet('');
    setFormHaiku('');
    setFormPreset('');
  }, [setEditingProfile]);

  // Edit profile
  const handleEdit = useCallback((name: string) => {
    const profile = profiles[name];
    if (!profile) return;
    setEditingProfile(name);
    setFormName(name);
    setFormBaseUrl(profile.env.ANTHROPIC_BASE_URL || '');
    setFormOpus(profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL || '');
    setFormSonnet(profile.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '');
    setFormHaiku(profile.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '');
    setFormToken('');
    // Auto-scroll to form card on small viewports
    setTimeout(() => {
      const formEl = document.querySelector(`.${styles.formCard}`);
      if (formEl) {
        formEl.scrollIntoView({ behavior: 'smooth' });
      }
    }, 50);
  }, [profiles, setEditingProfile]);

  // Save profile
  const handleSave = useCallback(async () => {
    const currentName = formName.trim();
    if (!currentName) {
      showToast('请填写套餐名称');
      return;
    }

    const envData: ClaudeEnv = {};
    if (formToken) envData.ANTHROPIC_AUTH_TOKEN = formToken;
    if (formBaseUrl) envData.ANTHROPIC_BASE_URL = formBaseUrl;
    if (formOpus) envData.ANTHROPIC_DEFAULT_OPUS_MODEL = formOpus;
    if (formSonnet) envData.ANTHROPIC_DEFAULT_SONNET_MODEL = formSonnet;
    if (formHaiku) envData.ANTHROPIC_DEFAULT_HAIKU_MODEL = formHaiku;

    try {
      if (editingProfile) {
        if (currentName !== editingProfile) {
          const isSaveAsNew = await showConfirm(
            '套餐名称已变更',
            `检测到套餐名称已由「${editingProfile}」修改为「${currentName}」。\n\n是否将此配置【另存为新套餐】？\n\n- 点击「确认」：创建名为「${currentName}」的新套餐（原「${editingProfile}」保持不变）\n- 点击「取消」：将此修改更新至原套餐「${editingProfile}」（套餐名称不变更）`,
            'primary',
            '另存为新套餐'
          );

          if (isSaveAsNew) {
            await clone(editingProfile, currentName, envData);
            showToast(`已另存为新套餐「${currentName}」`);
          } else {
            if (!formToken && Object.keys(envData).length === 0) {
              showToast('请至少填写一项进行更新');
              return;
            }
            await update(editingProfile, envData);
            showToast(`套餐「${editingProfile}」配置已更新`);
          }
        } else {
          if (!formToken && Object.keys(envData).length === 0) {
            showToast('请至少填写一项进行更新');
            return;
          }
          await update(editingProfile, envData);
          showToast(`套餐「${editingProfile}」已更新`);
        }
      } else {
        if (!formToken) {
          showToast('请填写 API Key');
          return;
        }
        await add(currentName, envData);
        showToast(`套餐「${currentName}」已添加`);
      }
      clearForm();
    } catch (e) {
      showToast(`保存失败: ${(e as Error).message}`);
    }
  }, [editingProfile, formName, formToken, formBaseUrl, formOpus, formSonnet, formHaiku, add, update, clone, clearForm, showToast, showConfirm]);

  // Switch profile
  const handleSwitch = useCallback(async (name: string) => {
    const isConfirmed = await showConfirm(
      '切换套餐',
      `您确定要切换至套餐「${name}」吗？激活后新配置将立即对 Claude Code 生效。`,
      'primary',
      '确认切换'
    );
    if (!isConfirmed) return;
    try {
      await switchTo(name);
      showToast(`已切换到「${name}」，请重启 Claude Code`);
      loadBackups().catch(() => {}); // 刷新备份列表失败不影响主流程，用户可手动重载
    } catch (e) {
      showToast(`切换失败: ${(e as Error).message}`);
    }
  }, [switchTo, showToast, loadBackups, showConfirm]);

  // Delete profile
  const handleDelete = useCallback(async (name: string) => {
    const isConfirmed = await showConfirm(
      '删除套餐',
      `确定要删除套餐「${name}」吗？\n\n提示：此操作会自动生成快照备份，如有需要，您可在「备份与恢复」面板中随时还原。`,
      'danger',
      '确认删除'
    );
    if (!isConfirmed) return;
    try {
      await remove(name);
      showToast(`已删除「${name}」`);
    } catch (e) {
      showToast(`删除失败: ${(e as Error).message}`);
    }
  }, [remove, showToast, showConfirm]);

  // Load backups
  const handleLoadBackups = useCallback(async () => {
    try {
      await loadBackups();
    } catch (e) {
      showToast(`加载备份失败: ${(e as Error).message}`);
    }
  }, [loadBackups, showToast]);

  // Select backup file for inline preview
  const handleSelectBackup = useCallback(async (fileName: string) => {
    setActiveBackupFile(fileName);
    setIsLoadingDiff(true);
    try {
      const diff = await preview(fileName);
      setActiveBackupDiff(diff);
    } catch (e) {
      showToast(`加载差异数据失败: ${(e as Error).message}`);
      setActiveBackupDiff(null);
    } finally {
      setIsLoadingDiff(false);
    }
  }, [preview, showToast]);

  // Restore backup
  const handleRestoreBackup = useCallback(async (fileName: string) => {
    const isConfirmed = await showConfirm(
      '还原备份',
      `确定要将当前的 ${backupType === 'settings' ? '系统环境底层配置' : '套餐数据'} 还原到备份文件「${fileName}」的状态吗？\n\n还原前，系统会自动为当前状态生成快照以防万一。`,
      'warning',
      '确认还原'
    );
    if (!isConfirmed) return;
    try {
      await restore(fileName);
      showToast('还原成功，请重启 Claude Code');
      loadProfiles();
      loadCurrentEnv();
      loadBackups().catch(() => {}); // 还原后刷新备份列表失败不影响还原成功状态
      setActiveBackupFile('');
      setActiveBackupDiff(null);
    } catch (e) {
      showToast(`还原失败: ${(e as Error).message}`);
    }
  }, [backupType, restore, loadProfiles, loadCurrentEnv, loadBackups, showToast, showConfirm]);

  // Load logs
  const handleLoadLogs = useCallback(async () => {
    try {
      await loadLogs(logDate);
    } catch (e) {
      showToast(`加载日志失败: ${(e as Error).message}`);
    }
  }, [loadLogs, logDate, showToast]);
  return (
    <div className={styles.container}>
      {/* SaaS Premium Top Navigation Bar */}
      <nav className={styles.navbar}>
        <div className={styles.navBrand}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="url(#gradient-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 2px 8px rgba(99, 102, 241, 0.4))' }}>
            <defs>
              <linearGradient id="gradient-accent" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <h1>Claude Switch</h1>
        </div>
        <div className={styles.navTabs}>
          <button
            className={`${styles.navTabButton} ${activeTab === 'workspace' ? styles.navTabActive : ''}`}
            onClick={() => setActiveTab('workspace')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
            配置工作台
          </button>
          <button
            className={`${styles.navTabButton} ${activeTab === 'backups' ? styles.navTabActive : ''}`}
            onClick={() => setActiveTab('backups')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            备份与恢复
          </button>
          <button
            className={`${styles.navTabButton} ${activeTab === 'logs' ? styles.navTabActive : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            系统审计日志
          </button>
        </div>
      </nav>

      {/* Workspace View */}
      {activeTab === 'workspace' && (
        <div className={styles.workspaceLayout}>
          {/* LEFT: Active Env & Form */}
          <div className={styles.mainCol}>
            {/* Active Env Card */}
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                生效环境变量
              </h2>
              <div className={styles.statusTable}>
                <div className={styles.statusRow}>
                  <span className={styles.statusKey}>生效套餐</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={styles.statusValue} style={{ fontWeight: 700, color: envMismatch ? 'var(--warning)' : 'var(--accent)' }}>
                      {activeProfile || '未知配置'}
                    </span>
                    {envMismatch ? (
                      <span className={`${styles.statusBadge} ${styles.statusMismatchBadge}`}>
                        环境差异 ⚠️
                      </span>
                    ) : (
                      <span className={styles.statusBadge}>
                        已激活
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusKey}>API Key</span>
                  <span className={styles.statusValue}>
                    {env.ANTHROPIC_AUTH_TOKEN ? `sk-••••${env.ANTHROPIC_AUTH_TOKEN.slice(-4)}` : '未配置'}
                  </span>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusKey}>接口中转 URL</span>
                  <span className={styles.statusValue} title={env.ANTHROPIC_BASE_URL || '官方默认'}>
                    {env.ANTHROPIC_BASE_URL || '官方默认'}
                  </span>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusKey}>Sonnet 模型</span>
                  <span className={styles.statusValue} title={env.ANTHROPIC_DEFAULT_SONNET_MODEL || '官方默认'}>
                    {env.ANTHROPIC_DEFAULT_SONNET_MODEL || '官方默认'}
                  </span>
                </div>
                {env.ANTHROPIC_DEFAULT_OPUS_MODEL && (
                  <div className={styles.statusRow}>
                    <span className={styles.statusKey}>Opus 模型</span>
                    <span className={styles.statusValue} title={env.ANTHROPIC_DEFAULT_OPUS_MODEL}>
                      {env.ANTHROPIC_DEFAULT_OPUS_MODEL}
                    </span>
                  </div>
                )}
                {env.ANTHROPIC_DEFAULT_HAIKU_MODEL && (
                  <div className={styles.statusRow}>
                    <span className={styles.statusKey}>Haiku 模型</span>
                    <span className={styles.statusValue} title={env.ANTHROPIC_DEFAULT_HAIKU_MODEL}>
                      {env.ANTHROPIC_DEFAULT_HAIKU_MODEL}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Inline Config Form Card */}
            <div className={`${styles.formCard} ${editingProfile ? styles.formActiveBorder : ''}`}>
              <h2 className={styles.cardTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                {editingProfile ? `编辑套餐配置: ${editingProfile}` : '创建新配置套餐'}
              </h2>

              <div className={styles.formGroup}>
                <label className={styles.label}>厂商套餐模板（快速填充）</label>
                <select
                  className={styles.input}
                  value={formPreset}
                  onChange={(e) => {
                    setFormPreset(e.target.value);
                    applyPreset(e.target.value);
                  }}
                >
                  <option value="">-- 手动填写表单 --</option>
                  {Object.entries(presets).map(([key, p]) => (
                    <option key={key} value={key}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>套餐名称</label>
                <input
                  className={styles.input}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="如: deepseek-pro, aliyun-opus"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>API Key (授权令牌)</label>
                <input
                  className={styles.input}
                  type="password"
                  value={formToken}
                  onChange={(e) => setFormToken(e.target.value)}
                  placeholder={editingProfile ? '保持不变（留空代表不修改原 Key）' : 'sk-...'}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Base URL (接口中转网关)</label>
                <input
                  className={styles.input}
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  placeholder="https://api.anthropic.com (留空则默认为官方)"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Opus 模型</label>
                  <input
                    className={styles.input}
                    value={formOpus}
                    onChange={(e) => setFormOpus(e.target.value)}
                    placeholder="claude-3-opus-..."
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Sonnet 模型</label>
                  <input
                    className={styles.input}
                    value={formSonnet}
                    onChange={(e) => setFormSonnet(e.target.value)}
                    placeholder="claude-3-5-sonnet-..."
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Haiku 模型</label>
                  <input
                    className={styles.input}
                    value={formHaiku}
                    onChange={(e) => setFormHaiku(e.target.value)}
                    placeholder="claude-3-5-haiku-..."
                  />
                </div>
              </div>

              <div className={styles.row} style={{ borderTop: '1px solid var(--border)', paddingTop: '18px', marginTop: '18px' }}>
                {editingProfile && (
                  <button className={`${styles.btn} ${styles.btnOutline}`} onClick={clearForm}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                    取消编辑
                  </button>
                )}

                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave} style={{ marginLeft: 'auto' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  保存套餐
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: Saved Profiles Grid */}
          <div className={styles.sideCol}>
            <div className={styles.card} style={{ minHeight: '500px' }}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="9" />
                    <rect x="14" y="3" width="7" height="5" />
                    <rect x="14" y="12" width="7" height="9" />
                    <rect x="3" y="16" width="7" height="5" />
                  </svg>
                  已保存的套餐库
                </h2>
                {!editingProfile && (
                  <button className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`} onClick={handleCreateNew}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    新建套餐
                  </button>
                )}
              </div>
              
              <div className={styles.profileList}>
                {Object.keys(profiles).length === 0 ? (
                  <div className={styles.emptyState}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="9" x2="15" y2="9" />
                      <line x1="9" y1="13" x2="15" y2="13" />
                      <line x1="9" y1="17" x2="15" y2="17" />
                    </svg>
                    暂无保存的套餐，请在左侧面板创建您的第一个配置套餐
                  </div>
                ) : (
                  Object.entries(profiles).map(([name, profile]) => (
                    <ProfileItem
                      key={name}
                      name={name}
                      env={profile.env}
                      isCurrent={name === active}
                      mismatch={name === active && mismatch}
                      onSwitch={() => handleSwitch(name)}
                      onEdit={() => handleEdit(name)}
                      onDelete={() => handleDelete(name)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Backups & Revert View */}
      {activeTab === 'backups' && (
        <div className={styles.diagnosticsLayout}>
          {/* Left: Backup list */}
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              历史备份管理
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--sub)', marginBottom: '16px' }}>
              系统在每次写入/修改底层配置文件时，均会自动创建双层安全备份。
            </p>
            
            <div className={styles.row} style={{ marginBottom: '18px' }}>
              <select
                className={styles.input}
                style={{ flex: 1, padding: '9px 12px' }}
                value={backupType}
                onChange={(e) => {
                  setBackupType(e.target.value as BackupType);
                  setActiveBackupFile('');
                  setActiveBackupDiff(null);
                }}
              >
                <option value="settings">settings.json (系统环境底层备份)</option>
                <option value="profiles">profiles.json (保存套餐数据备份)</option>
              </select>
              
              <button className={`${styles.btn} ${styles.btnOutline}`} onClick={handleLoadBackups}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                重载列表
              </button>
            </div>

            <div className={styles.terminalContainer}>
              <div className={styles.terminalHeader}>
                <div className={styles.terminalControls}>
                  <span className={`${styles.terminalDot} ${styles.dotRed}`}></span>
                  <span className={`${styles.terminalDot} ${styles.dotYellow}`}></span>
                  <span className={`${styles.terminalDot} ${styles.dotGreen}`}></span>
                </div>
                <div className={styles.terminalTitle}>backups_list.db</div>
              </div>
              <div className={styles.logText} style={{ maxHeight: '420px', padding: 0 }}>
                {backups.length === 0 ? (
                  <div className={styles.emptyState}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                      <path d="M12 12v9M8 17l4 4 4-4" />
                    </svg>
                    <span>无可用备份记录，点击右上角「重载列表」再次检索</span>
                  </div>
                ) : (
                  backups.map((b) => (
                    <BackupItem
                      key={b.fileName}
                      fileName={b.fileName}
                      reason={b.reason}
                      isSelected={b.fileName === activeBackupFile}
                      onClick={() => handleSelectBackup(b.fileName)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: Selected Backup Diff OR Guide Card */}
          {activeBackupFile ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1" />
                  <path d="M18 8h4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4" />
                  <line x1="8" y1="10" x2="8" y2="14" />
                  <line x1="6" y1="12" x2="10" y2="12" />
                </svg>
                备份参数 Diff 差异对比: {activeBackupFile}
              </h2>
              
              <div style={{ marginTop: '16px', marginBottom: '24px' }}>
                {isLoadingDiff ? (
                  <div className={styles.emptyState}>
                    <div className={styles.spinner} />
                    <span>正在加载差异数据...</span>
                  </div>
                ) : activeBackupDiff ? (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '16px', background: 'var(--bg)' }}>
                    <DiffModalContent diff={activeBackupDiff} type={backupType} />
                  </div>
                ) : (
                  <div className={styles.emptyState}>无法读取差异数据</div>
                )}
              </div>

              {activeBackupDiff && (
                <div className={styles.row} style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                  <button 
                    className={`${styles.btn} ${styles.btnDanger}`} 
                    onClick={() => handleRestoreBackup(activeBackupFile)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    确认还原此备份
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                数据恢复说明指南
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '0.9rem', lineHeight: '1.6', color: 'var(--sub)' }}>
                <div style={{ background: 'var(--accent-light)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99, 102, 241, 0.1)', color: 'var(--text)', fontWeight: 500 }}>
                  请从左侧列表选择一个备份文件，系统将在此处自动加载该备份与当前环境的详细参数 Diff 差异对比，并提供一键安全还原控制。
                </div>
                <div>
                  <strong style={{ color: 'var(--text)' }}>1. 什么是底层备份?</strong>
                  <p>每次激活新套餐时，程序会自动备份 Claude Code 底层原始的 `settings.json` 文件。在极端配置损坏时，可一键复原出厂设置。</p>
                </div>
                <div>
                  <strong style={{ color: 'var(--text)' }}>2. 如何验证备份?</strong>
                  <p>选择备份文件后，右侧卡片会为您渲染出直观易读的 Diff 差异对比，绿色代表新增参数，红色代表已删除的原有参数。</p>
                </div>
                <div style={{ background: 'var(--accent-light)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99, 102, 241, 0.1)' }}>
                  <strong style={{ color: 'var(--accent)', display: 'block', marginBottom: '4px' }}>💡 提示</strong>
                  恢复操作是 100% 安全且可以随时回滚的，恢复前系统会自动再次为当前状态生成快照。
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Logs View */}
      {activeTab === 'logs' && (
        <div className={styles.logsLayout}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                运行审计日志流
              </h2>
              
              <div className={styles.row} style={{ margin: 0 }}>
                <input
                  className={styles.input}
                  type="date"
                  style={{ width: '160px', padding: '8px 12px' }}
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                />
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleLoadLogs}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  检索日志
                </button>
              </div>
            </div>

            <div className={styles.logsTerminal}>
              <div className={styles.terminalHeader}>
                <div className={styles.terminalControls}>
                  <span className={`${styles.terminalDot} ${styles.dotRed}`}></span>
                  <span className={`${styles.terminalDot} ${styles.dotYellow}`}></span>
                  <span className={`${styles.terminalDot} ${styles.dotGreen}`}></span>
                </div>
                <div className={styles.terminalTitle}>operation_audit.log</div>
              </div>
              <div style={{ maxHeight: '600px', overflowY: 'auto', background: 'var(--terminal-bg)' }}>
                {logs.length === 0 ? (
                  <div className={styles.emptyState}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>暂无日志记录，选择特定日期并点击「检索日志」</span>
                  </div>
                ) : (
                  logs.flatMap((logGroup) => {
                    const lines = logGroup.content.split('\n').filter(Boolean);
                    return lines.map((line, idx) => {
                      const levelClass = parseLogLevel(line);
                      return (
                        <div key={`${logGroup.date}-${idx}`} className={`${styles.logRow} ${levelClass}`}>
                          <span className={styles.logTime}>{logGroup.date}</span>
                          <span className={styles.logContent}>{line}</span>
                        </div>
                      );
                    });
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast popup */}
      <Toast message={toast.message} visible={toast.visible} />

      {/* Custom Dialog popup */}
      {dialogConfig && (
        <CustomDialog
          isOpen={dialogConfig.isOpen}
          type={dialogConfig.type}
          title={dialogConfig.title}
          message={dialogConfig.message}
          defaultValue={dialogConfig.defaultValue}
          placeholder={dialogConfig.placeholder}
          confirmText={dialogConfig.confirmText}
          cancelText={dialogConfig.cancelText}
          intent={dialogConfig.intent}
          onClose={dialogConfig.onClose}
          onConfirm={dialogConfig.onConfirm}
        />
      )}
    </div>
  );
}

// Diff Modal content component
function DiffModalContent({ diff, type }: { diff: ProfileDiff | SettingsDiff; type: BackupType }) {
  if (type === 'profiles' && 'added' in diff) {
    const profileDiff = diff as ProfileDiff;
    const addedCount = profileDiff.added?.length || 0;
    const removedCount = profileDiff.removed?.length || 0;
    const changedCount = profileDiff.changed?.length || 0;
    const unchangedCount = profileDiff.unchanged?.length || 0;

    return (
      <div className={styles.diffDashboard}>
        {/* Metric cards grid */}
        <div className={styles.diffSummaryGrid}>
          <div className={`${styles.diffSummaryCard} ${styles.diffCardAdded}`}>
            <span className={`${styles.diffCount} ${styles.diffCountAdded}`}>+{addedCount}</span>
            <span className={styles.diffLabel}>新增套餐</span>
          </div>
          <div className={`${styles.diffSummaryCard} ${styles.diffCardRemoved}`}>
            <span className={`${styles.diffCount} ${styles.diffCountRemoved}`}>-{removedCount}</span>
            <span className={styles.diffLabel}>删除套餐</span>
          </div>
          <div className={`${styles.diffSummaryCard} ${styles.diffCardChanged}`}>
            <span className={`${styles.diffCount} ${styles.diffCountChanged}`}>~{changedCount}</span>
            <span className={styles.diffLabel}>变更套餐</span>
          </div>
          <div className={`${styles.diffSummaryCard} ${styles.diffCardUnchanged}`}>
            <span className={`${styles.diffCount} ${styles.diffCountUnchanged}`}>{unchangedCount}</span>
            <span className={styles.diffLabel}>未变套餐</span>
          </div>
        </div>

        {/* Added profiles */}
        {addedCount > 0 && (
          <div className={styles.diffSection}>
            <div className={styles.diffSectionTitle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>新增套餐</span>
            </div>
            <div className={styles.diffBadgeGrid}>
              {profileDiff.added.map(name => (
                <span key={name} className={`${styles.diffBadge} ${styles.badgeAdded}`}>{name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Removed profiles */}
        {removedCount > 0 && (
          <div className={styles.diffSection}>
            <div className={styles.diffSectionTitle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>删除套餐</span>
            </div>
            <div className={styles.diffBadgeGrid}>
              {profileDiff.removed.map(name => (
                <span key={name} className={`${styles.diffBadge} ${styles.badgeRemoved}`}>{name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Changed profiles with detailed tables */}
        {changedCount > 0 && (
          <div className={styles.diffSection}>
            <div className={styles.diffSectionTitle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
              </svg>
              <span>变更套餐详情</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {profileDiff.changed.map((ch) => (
                <div key={ch.profile} className={styles.changedProfileCard}>
                  <div className={styles.changedProfileHeader}>
                    <div className={styles.changedProfileTitle}>
                      <span className={styles.changedProfileDot}></span>
                      <span>套餐: {ch.profile}</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 600 }}>检测到配置变更</span>
                  </div>
                  <div className={styles.changedProfileTableWrapper}>
                    <DiffTable changes={ch.changes} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unchanged profiles collapsed */}
        {unchangedCount > 0 && (
          <details className={styles.diffDetails}>
            <summary className={styles.diffSummary}>
              <div className={styles.diffSummaryText}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path>
                  <path d="M22 12H2"></path>
                </svg>
                <span>未变套餐 ({unchangedCount})</span>
              </div>
              <svg className={styles.diffSummaryIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </summary>
            <div className={styles.diffDetailsContent}>
              <div className={styles.diffBadgeGrid}>
                {profileDiff.unchanged.map(name => (
                  <span key={name} className={`${styles.diffBadge} ${styles.badgeUnchanged}`}>{name}</span>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    );
  } else {
    // Settings diff
    const settingsDiff = diff as SettingsDiff;
    const addedCount = settingsDiff.added?.length || 0;
    const removedCount = settingsDiff.removed?.length || 0;
    const changedCount = settingsDiff.changed?.length || 0;
    const unchangedCount = settingsDiff.unchanged?.length || 0;

    return (
      <div className={styles.diffDashboard}>
        {/* Metric cards grid */}
        <div className={styles.diffSummaryGrid}>
          <div className={`${styles.diffSummaryCard} ${styles.diffCardAdded}`}>
            <span className={`${styles.diffCount} ${styles.diffCountAdded}`}>+{addedCount}</span>
            <span className={styles.diffLabel}>新增项</span>
          </div>
          <div className={`${styles.diffSummaryCard} ${styles.diffCardRemoved}`}>
            <span className={`${styles.diffCount} ${styles.diffCountRemoved}`}>-{removedCount}</span>
            <span className={styles.diffLabel}>删除项</span>
          </div>
          <div className={`${styles.diffSummaryCard} ${styles.diffCardChanged}`}>
            <span className={`${styles.diffCount} ${styles.diffCountChanged}`}>~{changedCount}</span>
            <span className={styles.diffLabel}>变更项</span>
          </div>
          <div className={`${styles.diffSummaryCard} ${styles.diffCardUnchanged}`}>
            <span className={`${styles.diffCount} ${styles.diffCountUnchanged}`}>{unchangedCount}</span>
            <span className={styles.diffLabel}>未变项</span>
          </div>
        </div>

        {/* Added settings keys */}
        {addedCount > 0 && (
          <div className={styles.diffSection}>
            <div className={styles.diffSectionTitle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>新增配置项</span>
            </div>
            <div className={styles.diffBadgeGrid}>
              {settingsDiff.added?.map(name => (
                <span key={name} className={`${styles.diffBadge} ${styles.badgeAdded}`}>{name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Removed settings keys */}
        {removedCount > 0 && (
          <div className={styles.diffSection}>
            <div className={styles.diffSectionTitle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>删除配置项</span>
            </div>
            <div className={styles.diffBadgeGrid}>
              {settingsDiff.removed?.map(name => (
                <span key={name} className={`${styles.diffBadge} ${styles.badgeRemoved}`}>{name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Detailed changed settings table */}
        {changedCount > 0 && settingsDiff.changed && (
          <div className={styles.diffSection}>
            <div className={styles.diffSectionTitle}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
              </svg>
              <span>变更明细表</span>
            </div>
            <div className={styles.changedProfileCard}>
              <div className={styles.changedProfileHeader}>
                <div className={styles.changedProfileTitle}>
                  <span className={styles.changedProfileDot}></span>
                  <span>全局配置 (settings.json)</span>
                </div>
              </div>
              <div className={styles.changedProfileTableWrapper}>
                <DiffTable changes={settingsDiff.changed} />
              </div>
            </div>
          </div>
        )}

        {/* Unchanged settings collapsed */}
        {unchangedCount > 0 && (
          <details className={styles.diffDetails}>
            <summary className={styles.diffSummary}>
              <div className={styles.diffSummaryText}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path>
                  <path d="M22 12H2"></path>
                </svg>
                <span>未变配置项 ({unchangedCount})</span>
              </div>
              <svg className={styles.diffSummaryIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </summary>
            <div className={styles.diffDetailsContent}>
              <div className={styles.diffBadgeGrid}>
                {settingsDiff.unchanged?.map(name => (
                  <span key={name} className={`${styles.diffBadge} ${styles.badgeUnchanged}`}>{name}</span>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    );
  }
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;