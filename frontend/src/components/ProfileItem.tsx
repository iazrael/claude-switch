import styles from '../styles/components/ProfileItem.module.css';
import appStyles from '../styles/App.module.css';
import type { ClaudeEnv } from '../types/api';

interface ProfileItemProps {
  name: string;
  env: ClaudeEnv;
  isCurrent: boolean;
  mismatch: boolean;
  onSwitch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProfileItem({
  name,
  env,
  isCurrent,
  mismatch,
  onSwitch,
  onEdit,
  onDelete,
}: ProfileItemProps) {
  const sonnet = env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  const opus = env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  const haiku = env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  const baseUrl = env.ANTHROPIC_BASE_URL || '官方默认';

  return (
    <div className={`${styles.profileItem} ${isCurrent ? styles.profileActive : ''}`}>
      <div className={styles.profileHeader}>
        <div className={styles.profileInfo}>
          <div className={styles.profileName}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            {name}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {isCurrent && <span className={`${styles.badge} ${styles.currentBadge}`}>当前生效</span>}
          {isCurrent && mismatch && <span className={`${styles.badge} ${styles.mismatchBadge}`}>环境差异 ⚠️</span>}
        </div>
      </div>

      <div className={styles.profileMeta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Base URL</span>
          <span className={styles.metaValue} title={baseUrl}>{baseUrl}</span>
        </div>
        {opus && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Opus</span>
            <span className={styles.metaValue} title={opus}>{opus}</span>
          </div>
        )}
        {sonnet && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Sonnet</span>
            <span className={styles.metaValue} title={sonnet}>{sonnet}</span>
          </div>
        )}
        {haiku && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Haiku</span>
            <span className={styles.metaValue} title={haiku}>{haiku}</span>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button 
          className={`${appStyles.btn} ${appStyles.btnPrimary} ${appStyles.btnSm}`} 
          onClick={onSwitch}
          disabled={isCurrent}
          title={isCurrent ? "当前套餐已激活" : "切换至该套餐"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {isCurrent ? (
              <>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </>
            ) : (
              <>
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </>
            )}
          </svg>
          {isCurrent ? "当前激活" : "一键激活"}
        </button>
        <button 
          className={`${appStyles.btn} ${appStyles.btnOutline} ${appStyles.btnSm}`} 
          onClick={onEdit}
          title="编辑套餐配置"
          style={{ padding: '6px 8px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
        <button 
          className={`${appStyles.btn} ${appStyles.btnOutline} ${appStyles.btnSm}`} 
          onClick={onDelete}
          title="删除套餐"
          style={{ padding: '6px 8px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </div>
    </div>
  );
}