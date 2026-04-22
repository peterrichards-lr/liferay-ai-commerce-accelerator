import { useCallback, useEffect, useMemo, useState } from 'react';
import { getKeyValue, persistConfigKey } from '../utils/api';

export const useObjectStorage = ({ keys, defaults = {}, json = true }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState(defaults);
  const [lastSaved, setLastSaved] = useState(defaults);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(lastSaved),
    [values, lastSaved]
  );

  const keyString = useMemo(() => keys.join(','), [keys]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const fetchedValues = await Promise.all(
          keys.map((key) => getKeyValue(key))
        );

        const newValues = {};
        keys.forEach((key, index) => {
          const raw = fetchedValues[index];
          if (json) {
            try {
              if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                  newValues[key] = parsed;
                } else if (typeof parsed === 'object' && parsed !== null) {
                  newValues[key] = { ...defaults[key], ...parsed };
                } else {
                  newValues[key] = parsed;
                }
              } else {
                newValues[key] = defaults[key];
              }
            } catch {
              newValues[key] = defaults[key];
            }
          } else {
            newValues[key] = raw || defaults[key];
          }
        });

        if (alive) {
          setValues(newValues);
          setLastSaved(newValues);
        }
      } catch (e) {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load configuration.',
          type: 'danger',
        });
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [keyString, json, defaults]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await Promise.all(
        keys.map((key) =>
          persistConfigKey(
            key,
            json ? JSON.stringify(values[key]) : values[key]
          )
        )
      );
      setLastSaved(values);
      Liferay?.Util?.openToast?.({
        message: 'Configuration saved.',
        type: 'success',
      });
    } catch (e) {
      console.error(e);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save configuration.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, values, keys, json]);

  const onCancel = useCallback(() => setValues(lastSaved), [lastSaved]);

  const setValue = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  return {
    loading,
    saving,
    values,
    lastSaved,
    dirty,
    onSave,
    onCancel,
    setValue,
    setValues,
  };
};
