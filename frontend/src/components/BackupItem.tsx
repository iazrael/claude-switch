import styles from '../styles/components/BackupItem.module.css';
import appStyles from '../styles/App.module.css';

interface BackupItemProps {
  fileName: string;
  reason?: string;
  onPreview: () => void;
  onRestore: () => void;
}

export function BackupItem({ fileName, reason, onPreview, onRestore }: BackupItemProps) {
  return (
    <div className={styles.backupItem}>
      <div className={styles.backupLeft}>
        <span>{fileName}</span>
        {reason && <span className={styles.backupReason}>{reason}</span>}
      </div>
      <div className={styles.backupButtons}>
        <button className={`${appStyles.btn} ${appStyles.btnOutline} ${appStyles.btnSm}`} onClick={onPreview}>
          预览
        </button>
        <button className={`${appStyles.btn} ${appStyles.btnOutline} ${appStyles.btnSm}`} onClick={onRestore}>
          还原
        </button>
      </div>
    </div>
  );
}