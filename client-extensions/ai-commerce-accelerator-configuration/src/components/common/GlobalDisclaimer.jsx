import { useState, useEffect } from 'react';
import ClayAlert from '@clayui/alert';

export default function GlobalDisclaimer({
  text = '',
  localStorageKey = 'globalDisclaimerDismissed',
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(localStorage.getItem(localStorageKey) === '1');
    } catch {
      // Ignore storage errors
    }
  }, [localStorageKey]);

  if (!text || dismissed) return null;

  return (
    <ClayAlert
      displayType="warning"
      className="mb-3"
      title="Important"
      onClose={() => {
        setDismissed(true);
        try {
          localStorage.setItem(localStorageKey, '1');
        } catch {
          // Ignore storage errors
        }
      }}
    >
      {text}
    </ClayAlert>
  );
}
