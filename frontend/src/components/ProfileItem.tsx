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
  const model = env.ANTHROPIC_DEFAULT_SONNET_MODEL || '无模型';
  const baseUrl = env.ANTHROPIC_BASE_URL || '默认';

  return (
    <div className={styles.profileItem}>
      <div className={styles.profileInfo}>
        <div className={styles.profileName}>
          {name}
          {isCurrent && <span className={styles.currentBadge}>当前</span>}
          {isCurrent && mismatch && <span className={styles.mismatchBadge}>⚠️ 环境已变更</span>}
        </div>
        <div className={styles.profileMeta}>
          模型：{model}
          <br />
          Base：{baseUrl}
        </div>
      </div>
      <div className={appStyles.row}>
        <button className={`${appStyles.btn} ${appStyles.btnPrimary} ${appStyles.btnSm}`} onClick={onSwitch}>
          切换
        </button>
        <button className={`${appStyles.btn} ${appStyles.btnOutline} ${appStyles.btnSm}`} onClick={onEdit}>
          ✏️
        </button>
        <button className={`${appStyles.btn} ${appStyles.btnDanger} ${appStyles.btnSm}`} onClick={onDelete}>
          删除
        </button>
      </div>
    </div>
  );
}