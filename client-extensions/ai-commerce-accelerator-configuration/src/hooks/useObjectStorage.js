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
  const defaultsString = useMemo(() => JSON.stringify(defaults), [defaults]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const parsedKeys = keyString ? keyString.split(',') : [];
        const parsedDefaults = defaultsString ? JSON.parse(defaultsString) : {};
        
        const fetchedValues = await Promise.all(
          parsedKeys.map((key) => getKeyValue(key))
        );

        const newValues = {};
        parsedKeys.forEach((key, index) => {
          const raw = fetchedValues[index];
          if (json) {
            try {
              if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                  newValues[key] = parsed;
                } else if (typeof parsed === 'object' && parsed !== null) {
                  newValues[key] = { ...parsedDefaults[key], ...parsed };
                } else {
                  newValues[key] = parsed;
                }
              } else {
                newValues[key] = parsedDefaults[key];
              }
            } catch {
              newValues[key] = parsedDefaults[key];
            }
          } else {
            newValues[key] = raw || parsedDefaults[key];
          }
        });

        if (alive) {
          setValues(newValues);
          setLastSaved(newValues);
        }
      } catch {
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
  }, [keyString, json, defaultsString]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const parsedKeys = keyString ? keyString.split(',') : [];
      await Promise.all(
        parsedKeys.map((key) =>
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
  }, [saving, values, keyString, json]);

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
