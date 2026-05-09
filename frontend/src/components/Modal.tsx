import styles from '../styles/components/Modal.module.css';

interface ModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

export function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div className={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <h3 className={styles.modalTitle}>{title}</h3>
        {children}
      </div>
    </div>
  );
}