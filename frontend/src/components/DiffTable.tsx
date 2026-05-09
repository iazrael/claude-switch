import styles from '../styles/components/DiffTable.module.css';
import type { DiffChange } from '../types/api';

interface DiffTableProps {
  changes: DiffChange[];
}

export function DiffTable({ changes }: DiffTableProps) {
  return (
    <table className={styles.diffTable}>
      <thead>
        <tr>
          <th>Key</th>
          <th>当前值</th>
          <th>备份值</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((ch, i) => (
          <tr key={i} className={styles.diffRowChanged}>
            <td>{ch.key}</td>
            <td>{formatValue(ch.newValue)}</td>
            <td>{formatValue(ch.oldValue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}