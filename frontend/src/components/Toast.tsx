import styles from '../styles/components/Toast.module.css';

interface ToastProps {
  message: string;
  visible: boolean;
}

export function Toast({ message, visible }: ToastProps) {
  return (
    <div className={`${styles.toast} ${visible ? styles.toastVisible : ''}`}>
      {message}
    </div>
  );
}