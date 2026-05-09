import { createContext, useContext, useState, useCallback } from 'react';

interface AppContextValue {
  // Toast
  toast: { message: string; visible: boolean };
  showToast: (msg: string, duration?: number) => void;

  // 编辑状态
  editingProfile: string | null;
  setEditingProfile: (name: string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState({ message: '', visible: false });
  const [editingProfile, setEditingProfile] = useState<string | null>(null);

  const showToast = useCallback((msg: string, duration = 2500) => {
    setToast({ message: msg, visible: true });
    setTimeout(() => setToast({ message: '', visible: false }), duration);
  }, []);

  return (
    <AppContext.Provider value={{ toast, showToast, editingProfile, setEditingProfile }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}