import { useState, useEffect, useRef } from 'react';
import styles from '../styles/components/CustomDialog.module.css';

interface CustomDialogProps {
  isOpen: boolean;
  type: 'prompt' | 'confirm';
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  intent?: 'primary' | 'danger' | 'warning';
  onClose: () => void;
  onConfirm: (inputValue?: string) => void;
}

export function CustomDialog({
  isOpen,
  type,
  title,
  message,
  defaultValue = '',
  placeholder = '',
  confirmText = '确认',
  cancelText = '取消',
  intent = 'primary',
  onClose,
  onConfirm,
}: CustomDialogProps) {
  const [inputValue, setInputValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync defaultValue state
  useEffect(() => {
    if (isOpen) {
      setInputValue(defaultValue);
      // Small timeout to ensure input element is mounted and visible
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, defaultValue]);

  // Handle keyboard events (Enter to confirm, Escape to cancel)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        // Prevent submission if prompt input is empty/whitespace-only
        if (type === 'prompt' && !inputValue.trim()) {
          return;
        }
        onConfirm(type === 'prompt' ? inputValue : undefined);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, type, inputValue, onClose, onConfirm]);

  if (!isOpen) return null;

  const handleConfirmClick = () => {
    if (type === 'prompt' && !inputValue.trim()) {
      return;
    }
    onConfirm(type === 'prompt' ? inputValue : undefined);
  };

  // Define icon based on intent & type
  const renderIcon = () => {
    if (intent === 'danger') {
      return (
        <div className={`${styles.iconContainer} ${styles.iconDanger}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
      );
    }
    if (intent === 'warning') {
      return (
        <div className={`${styles.iconContainer} ${styles.iconWarning}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
      );
    }
    // Default primary switch or prompt icon
    return (
      <div className={`${styles.iconContainer} ${styles.iconPrimary}`}>
        {type === 'prompt' ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5" />
            <path d="M4 20L21 3" />
            <path d="M21 16v5h-5" />
            <path d="M15 15l6 6" />
            <path d="M4 4l5 5" />
          </svg>
        )}
      </div>
    );
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialogCard} ${styles[intent]}`}>
        {/* Glow decoration */}
        <div className={styles.glowEffect}></div>

        <div className={styles.header}>
          {renderIcon()}
          <h3 className={styles.title}>{title}</h3>
          <button className={styles.closeButton} onClick={onClose} aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.message}>{message}</p>
          {type === 'prompt' && (
            <div className={styles.inputWrapper}>
              <input
                ref={inputRef}
                type="text"
                className={styles.input}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={placeholder}
                maxLength={40}
              />
              <span className={styles.inputFocusLine}></span>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={`${styles.btn} ${styles.btnCancel}`} onClick={onClose}>
            {cancelText}
          </button>
          <button
            className={`${styles.btn} ${styles.btnConfirm} ${styles[`btn-${intent}`]}`}
            onClick={handleConfirmClick}
            disabled={type === 'prompt' && !inputValue.trim()}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
