import { useState, useEffect } from 'react';
import ClayAlert from '@clayui/alert';

export default function GlobalDisclaimer({
  text = '',
  localStorageKey = 'globalDisclaimerDismissed',
}) {
  if (!text) return null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(localStorageKey) === '1');
    } catch {}
  }, [localStorageKey]);
  return dismissed ? null : (
    <ClayAlert
      displayType="warning"
      className="mb-3"
      title="Important"
      onClose={() => {
        setDismissed(true);
        try {
          localStorage.setItem(localStorageKey, '1');
        } catch {}
      }}
    >
      {text}
    </ClayAlert>
  );
}
