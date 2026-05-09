import { useState, useEffect, useCallback } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { useProfiles } from './hooks/useProfiles';
import { useCurrentEnv } from './hooks/useCurrentEnv';
import { usePresets } from './hooks/usePresets';
import { useBackups } from './hooks/useBackups';
import { useLogs } from './hooks/useLogs';
import { Toast } from './components/Toast';
import { Modal } from './components/Modal';
import { DiffTable } from './components/DiffTable';
import { ProfileItem } from './components/ProfileItem';
import { BackupItem } from './components/BackupItem';
import styles from './styles/App.module.css';
import type { BackupType, ProfileDiff, SettingsDiff, ClaudeEnv } from './types/api';

function AppContent() {
  const { toast, showToast, editingProfile, setEditingProfile } = useAppContext();
  const { profiles, active, mismatch, load: loadProfiles, switchTo, add, update, remove, clone } = useProfiles();
  const { env, activeProfile, mismatch: envMismatch, load: loadCurrentEnv } = useCurrentEnv();
  const { presets } = usePresets();

  const [backupType, setBackupType] = useState<BackupType>('settings');
  const { backups, load: loadBackups, restore, preview } = useBackups(backupType);

  const { logs, load: loadLogs } = useLogs();
  const [logDate, setLogDate] = useState<string>('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formToken, setFormToken] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formOpus, setFormOpus] = useState('');
  const [formSonnet, setFormSonnet] = useState('');
  const [formHaiku, setFormHaiku] = useState('');
  const [formPreset, setFormPreset] = useState('');

  // Diff Modal state
  const [diffModal, setDiffModal] = useState<{ visible: boolean; fileName: string; diff: ProfileDiff | SettingsDiff | null }>({
    visible: false,
    fileName: '',
    diff: null,
  });

  // Initial load
  useEffect(() => {
    loadProfiles();
    loadCurrentEnv();
  }, [loadProfiles, loadCurrentEnv]);

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
  }, [profiles, setEditingProfile]);

  // Save profile
  const handleSave = useCallback(async () => {
    const name = editingProfile || formName.trim();
    if (!name) {
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
        if (!formToken && Object.keys(envData).length === 0) {
          showToast('请至少填写一项');
          return;
        }
        await update(editingProfile, envData);
        showToast(`套餐「${name}」已更新`);
      } else {
        if (!formToken) {
          showToast('请填写 API Key');
          return;
        }
        await add(name, envData);
        showToast(`套餐「${name}」已添加`);
      }
      clearForm();
    } catch (e) {
      showToast(`保存失败: ${(e as Error).message}`);
    }
  }, [editingProfile, formName, formToken, formBaseUrl, formOpus, formSonnet, formHaiku, add, update, clearForm, showToast]);

  // Save as new profile
  const handleSaveAs = useCallback(async () => {
    if (!editingProfile) return;
    const newName = prompt('请输入新套餐名称：');
    if (!newName?.trim()) return;

    const overrides: ClaudeEnv = {};
    if (formToken) overrides.ANTHROPIC_AUTH_TOKEN = formToken;
    if (formBaseUrl) overrides.ANTHROPIC_BASE_URL = formBaseUrl;
    if (formOpus) overrides.ANTHROPIC_DEFAULT_OPUS_MODEL = formOpus;
    if (formSonnet) overrides.ANTHROPIC_DEFAULT_SONNET_MODEL = formSonnet;
    if (formHaiku) overrides.ANTHROPIC_DEFAULT_HAIKU_MODEL = formHaiku;

    try {
      await clone(editingProfile, newName.trim(), overrides);
      showToast(`已另存为新套餐「${newName.trim()}」`);
      clearForm();
    } catch (e) {
      showToast(`保存失败: ${(e as Error).message}`);
    }
  }, [editingProfile, formToken, formBaseUrl, formOpus, formSonnet, formHaiku, clone, clearForm, showToast]);

  // Switch profile
  const handleSwitch = useCallback(async (name: string) => {
    if (!confirm(`确定切换至套餐 "${name}" 吗？`)) return;
    try {
      await switchTo(name);
      showToast(`已切换到「${name}」，请重启 Claude Code`);
    } catch (e) {
      showToast(`切换失败: ${(e as Error).message}`);
    }
  }, [switchTo, showToast]);

  // Delete profile
  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`确定删除套餐 "${name}" 吗？\n此操作有备份，可还原。`)) return;
    try {
      await remove(name);
      showToast(`已删除「${name}」`);
    } catch (e) {
      showToast(`删除失败: ${(e as Error).message}`);
    }
  }, [remove, showToast]);

  // Load backups
  const handleLoadBackups = useCallback(async () => {
    try {
      await loadBackups();
    } catch (e) {
      showToast(`加载备份失败: ${(e as Error).message}`);
    }
  }, [loadBackups, showToast]);

  // Preview backup
  const handlePreviewBackup = useCallback(async (fileName: string) => {
    try {
      const diff = await preview(fileName);
      setDiffModal({ visible: true, fileName, diff });
    } catch (e) {
      showToast(`加载预览失败: ${(e as Error).message}`);
    }
  }, [preview, showToast]);

  // Restore backup
  const handleRestoreBackup = useCallback(async (fileName: string) => {
    if (!confirm(`确定还原 ${backupType} 到 ${fileName}？\n当前配置会被自动备份。`)) return;
    try {
      await restore(fileName);
      showToast('还原成功，请重启 Claude Code');
      loadProfiles();
      loadCurrentEnv();
    } catch (e) {
      showToast(`还原失败: ${(e as Error).message}`);
    }
  }, [backupType, restore, loadProfiles, loadCurrentEnv, showToast]);

  // Load logs
  const handleLoadLogs = useCallback(async () => {
    try {
      await loadLogs(logDate);
    } catch (e) {
      showToast(`加载日志失败: ${(e as Error).message}`);
    }
  }, [loadLogs, logDate, showToast]);

  // Environment variables text
  const envText = Object.keys(env).length === 0
    ? '未配置环境变量'
    : Object.entries(env).map(([k, v]) => `${k}: ${v}`).join('\n');

  // Current profile display
  const currentText = activeProfile
    ? `${activeProfile} (${env.ANTHROPIC_DEFAULT_SONNET_MODEL || ''})${envMismatch ? ' ⚠️ 环境已变更' : ''}`
    : env.ANTHROPIC_DEFAULT_SONNET_MODEL
      ? `未知 (${env.ANTHROPIC_DEFAULT_SONNET_MODEL})`
      : '无';

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>⚡ Claude 套餐管理</h1>
      <p className={styles.subtitle}>
        当前生效的套餐：<strong style={{ color: envMismatch ? 'var(--warning)' : 'var(--accent)' }}>{currentText}</strong>
      </p>
      <p style={{ color: 'var(--sub)', fontSize: '0.82rem', marginBottom: '12px' }}>
        💡 切换套餐时仅更新套餐定义的变量，settings.json 中的其他环境变量保持不变。
      </p>

      {/* Current environment */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>📍 当前环境变量</h2>
        <div className={styles.logText} style={{ maxHeight: '150px' }}>{envText}</div>
      </div>

      {/* Profile list */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>📦 已保存的套餐</h2>
        <div className={styles.profileList}>
          {Object.keys(profiles).length === 0 ? (
            <div className={styles.emptyState}>暂无套餐，请在下方添加</div>
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

      {/* Add/Edit profile form */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>➕ 添加 / 编辑套餐</h2>
        <div className={styles.formGroup}>
          <label className={styles.label}>厂商模板（可选）</label>
          <select
            className={styles.input}
            value={formPreset}
            onChange={(e) => {
              setFormPreset(e.target.value);
              applyPreset(e.target.value);
            }}
          >
            <option value="">-- 手动填写 --</option>
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
            placeholder="如 aliyun-pro"
            disabled={!!editingProfile}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>API Key</label>
          <input
            className={styles.input}
            type="password"
            value={formToken}
            onChange={(e) => setFormToken(e.target.value)}
            placeholder={editingProfile ? '保持不变（留空不修改）' : 'sk-...'}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Base URL</label>
          <input
            className={styles.input}
            value={formBaseUrl}
            onChange={(e) => setFormBaseUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Opus 模型</label>
          <input
            className={styles.input}
            value={formOpus}
            onChange={(e) => setFormOpus(e.target.value)}
            placeholder="复杂任务模型"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Sonnet 模型</label>
          <input
            className={styles.input}
            value={formSonnet}
            onChange={(e) => setFormSonnet(e.target.value)}
            placeholder="日常主力模型"
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Haiku 模型</label>
          <input
            className={styles.input}
            value={formHaiku}
            onChange={(e) => setFormHaiku(e.target.value)}
            placeholder="轻量任务模型"
          />
        </div>
        <div className={styles.row}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>保存套餐</button>
          {editingProfile && (
            <button className={`${styles.btn} ${styles.btnOutline}`} onClick={handleSaveAs}>另存为新套餐</button>
          )}
          <button className={`${styles.btn} ${styles.btnOutline}`} onClick={clearForm}>清空表单</button>
        </div>
        <p className={styles.hint}>编辑已有套餐请先点击列表中的 ✏️ 按钮</p>
      </div>

      {/* Backup and restore */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>⏪ 备份与还原</h2>
        <div className={styles.row} style={{ marginBottom: '12px' }}>
          <select
            className={styles.input}
            style={{ flex: 1 }}
            value={backupType}
            onChange={(e) => setBackupType(e.target.value as BackupType)}
          >
            <option value="settings">settings.json 备份</option>
            <option value="profiles">profiles.json 备份</option>
          </select>
          <button className={`${styles.btn} ${styles.btnOutline}`} onClick={handleLoadBackups}>查看备份</button>
        </div>
        <div className={styles.logText} style={{ maxHeight: '200px' }}>
          {backups.length === 0 ? '点击「查看备份」加载' : backups.map((b) => (
            <BackupItem
              key={b.fileName}
              fileName={b.fileName}
              reason={b.reason}
              onPreview={() => handlePreviewBackup(b.fileName)}
              onRestore={() => handleRestoreBackup(b.fileName)}
            />
          ))}
        </div>
      </div>

      {/* Operation logs */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>📋 操作日志</h2>
        <div className={styles.row} style={{ marginBottom: '12px' }}>
          <input
            className={styles.input}
            type="date"
            style={{ flex: 1 }}
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
          />
          <button className={`${styles.btn} ${styles.btnOutline}`} onClick={handleLoadLogs}>查询日志</button>
        </div>
        <div className={styles.logText}>
          {logs.length === 0
            ? '选择日期后点击查询'
            : logs.map((l) => `📅 ${l.date}\n${l.content}`).join('\n\n')}
        </div>
      </div>

      {/* Toast */}
      <Toast message={toast.message} visible={toast.visible} />

      {/* Diff Modal */}
      {diffModal.visible && diffModal.diff && (
        <Modal
          title={`Diff 预览: ${diffModal.fileName}`}
          onClose={() => setDiffModal({ visible: false, fileName: '', diff: null })}
        >
          <DiffModalContent diff={diffModal.diff} type={backupType} />
          <div className={styles.row} style={{ justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              className={`${styles.btn} ${styles.btnOutline}`}
              onClick={() => setDiffModal({ visible: false, fileName: '', diff: null })}
            >
              取消
            </button>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => {
                setDiffModal({ visible: false, fileName: '', diff: null });
                handleRestoreBackup(diffModal.fileName);
              }}
            >
              确认还原
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Diff Modal content component
function DiffModalContent({ diff, type }: { diff: ProfileDiff | SettingsDiff; type: BackupType }) {
  if (type === 'profiles' && 'added' in diff) {
    const profileDiff = diff as ProfileDiff;
    const parts: string[] = [];
    if (profileDiff.added.length) parts.push(`新增: ${profileDiff.added.join(', ')}`);
    if (profileDiff.removed.length) parts.push(`删除: ${profileDiff.removed.join(', ')}`);
    if (profileDiff.changed.length) parts.push(`变更: ${profileDiff.changed.map(c => c.profile).join(', ')}`);
    if (profileDiff.unchanged.length) parts.push(`未变: ${profileDiff.unchanged.join(', ')}`);

    return (
      <>
        <div style={{ marginBottom: '12px', fontSize: '0.85rem', color: 'var(--sub)' }}>
          {parts.join(' | ') || '无差异'}
        </div>
        {profileDiff.changed.map((ch) => (
          <div key={ch.profile} style={{ marginBottom: '10px' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>套餐: {ch.profile}</div>
            <DiffTable changes={ch.changes} />
          </div>
        ))}
      </>
    );
  } else {
    const settingsDiff = diff as SettingsDiff;
    const parts: string[] = [];
    if (settingsDiff.added?.length) parts.push(`新增: ${settingsDiff.added.join(', ')}`);
    if (settingsDiff.removed?.length) parts.push(`删除: ${settingsDiff.removed.join(', ')}`);
    if (settingsDiff.changed?.length) parts.push(`变更: ${settingsDiff.changed.length} 项`);
    if (settingsDiff.unchanged?.length) parts.push(`未变: ${settingsDiff.unchanged.length} 项`);

    return (
      <>
        <div style={{ marginBottom: '8px', fontSize: '0.85rem', color: 'var(--sub)' }}>
          {parts.join(' | ') || '无差异'}
        </div>
        {settingsDiff.changed && <DiffTable changes={settingsDiff.changed} />}
      </>
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