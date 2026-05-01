import React, {
  createContext,
  useState,
  useRef,
  useCallback,
  useContext,
  useEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';

const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // {title, message, confirmText, cancelText, destructive, resolve}
  const dialogRef = useRef(null);
  const okBtnRef = useRef(null);

  const { getRoot } = useApp();

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      setState({
        title: options.title ?? 'Are you sure?',
        message: options.message ?? 'This action cannot be undone.',
        confirmText: options.confirmText ?? 'Continue',
        cancelText: options.cancelText ?? 'Cancel',
        destructive: !!options.destructive,
        resolve,
      });
    });
  }, []);

  useEffect(() => {
    if (state && okBtnRef.current) {
      const t = setTimeout(() => okBtnRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [state]);

  const close = useCallback(
    (result) => {
      state?.resolve(result);
      setState(null);
    },
    [state]
  );

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [state, close]);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state &&
        createPortal(
          <div
            className="confirm-dialog__backdrop"
            aria-hidden="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close(false);
            }}
          >
            <div
              className="confirm-dialog__dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby="confirm-desc"
              ref={dialogRef}
            >
              <h2 id="confirm-title" className="confirm-dialog__title">
                {state.title}
              </h2>
              <p id="confirm-desc" className="confirm-dialog__message">
                {state.message}
              </p>
              <div className="confirm-dialog__actions">
                <button
                  type="button"
                  className="confirm-dialog__btn btn btn-secondary"
                  onClick={() => close(false)}
                >
                  {state.cancelText}
                </button>
                <button
                  type="button"
                  ref={okBtnRef}
                  className={`confirm-dialog__btn btn ${
                    state.destructive ? 'btn-danger' : 'btn-primary'
                  }`}
                  onClick={() => close(true)}
                >
                  {state.confirmText}
                </button>
              </div>
            </div>
          </div>,
          getRoot()
        )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}
