import React, {
  createContext,
  useState,
  useCallback,
  useContext,
} from 'react';
import ClayModal, { useModal } from '@clayui/modal';
import ClayButton from '@clayui/button';

const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // {title, message, confirmText, cancelText, destructive, resolve}

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

  const handleClose = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialog
          title={state.title}
          message={state.message}
          confirmText={state.confirmText}
          cancelText={state.cancelText}
          destructive={state.destructive}
          onClose={handleClose}
        />
      )}
    </ConfirmCtx.Provider>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  destructive,
  onClose,
}) {
  const { observer, onClose: handleModalClose } = useModal({
    onClose: () => onClose(false),
  });

  return (
    <ClayModal observer={observer} size="sm">
      <ClayModal.Header>{title}</ClayModal.Header>
      <ClayModal.Body>
        <p>{message}</p>
      </ClayModal.Body>
      <ClayModal.Footer
        last={
          <div className="btn-group">
            <ClayButton displayType="secondary" onClick={() => onClose(false)}>
              {cancelText}
            </ClayButton>
            <ClayButton
              displayType={destructive ? 'danger' : 'primary'}
              onClick={() => onClose(true)}
            >
              {confirmText}
            </ClayButton>
          </div>
        }
      />
    </ClayModal>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}
