import { useEffect } from 'react';

export const useForm = ({ dirty, onSave }) => {
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e) => {
      const key = e.key?.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave]);
};
