export const OBJECT_ROOT_PATH = '/o/c/aicaconfigurations';
export const DEFAULT_OBJECT_FIELDS =
  'externalReferenceCode,configKey,configValue,configStatus';
export const DEFAULT_REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

/**
 * Keep only the keys listed in csv.
 */
export function reduceObjectCSV(obj, fieldsCsv) {
  if (!obj || !fieldsCsv) return obj;
  return reduceObject(obj, fieldsCsv.split(','));
}

/**
 * Keep only the keys listed in the array.
 */
export const reduceObject = (obj, fields) => {
  if (!obj || !fields) return obj;
  return fields
    .map((k) => k.trim())
    .filter((k) => k in obj)
    .reduce((res, key) => {
      res[key] = obj[key];
      return res;
    }, {});
};

/**
 * A wrapper around Liferay.Util.fetch that throws on HTTP error and returns JSON otherwise.
 */
export const fetchJSON = async (
  input,
  options = {
    method: 'GET',
    headers: DEFAULT_REQUEST_HEADERS,
  }
) => {
  if (options?.headers['x-csrf-token'] == null)
    options.headers['x-csrf-token'] = Liferay.authToken;
  return Liferay.Util.fetch(input, options).then((response) => {
    if (!response.ok) {
      return response.text().then((text) => {
        const err = new Error(
          `HTTP ${response.status} ${response.statusText}` +
            (text ? `: ${text}` : '')
        );
        err.status = response.status;
        err.statusText = response.statusText;
        throw err;
      });
    }
    return response.json();
  });
};

export const getKeyObject = async (
  key,
  activeOnly = true,
  fields = DEFAULT_OBJECT_FIELDS
) => {
  const filter = encodeURIComponent(`configKey eq '${key}'`);
  return await fetchJSON(`${OBJECT_ROOT_PATH}?filter=${filter}`)
    .then((result) => {
      if (result.totalCount == 0) {
        return null;
      }
      if (result.totalCount > 1) {
        console.warn(
          `Multiple matches found for configuration key: ${key}. Using the first one.`
        );
      }
      return result.items[0];
    })
    .then((item) => {
      if (!item) return null;
      if (activeOnly && item.configStatus?.key === 'Active') {
        return reduceObjectCSV(item, fields);
      } else if (activeOnly && item.configStatus?.key !== 'Active') {
        return null;
      }
      return reduceObjectCSV(item, fields);
    });
};

export const getKeyValue = async (
  key,
  activeOnly = true,
  fields = DEFAULT_OBJECT_FIELDS
) => {
  const obj = await getKeyObject(key, activeOnly, fields);
  return obj?.configValue;
};

export const persistConfigKey = async (key, value) => {
  const existingConfig = await getKeyObject(key, false, 'id,configStatus');

  // Liferay Objects may have configValue as a required field.
  // If we are trying to save an empty value for a non-existent key, skip it.
  const isEmpty = !value || value === '' || value === '""' || value === 'null';

  if (!existingConfig && isEmpty) {
    return { skipped: true };
  }

  // If it's a PATCH and we want to "clear" it, we must send something
  // because configValue is a required field in Liferay. The microservice
  // parses the literal string '__AICA_EMPTY__' as an empty/missing configuration.
  const safeValue = isEmpty ? '__AICA_EMPTY__' : String(value);

  const options = {
    body: JSON.stringify({
      configKey: key,
      configStatus: existingConfig?.configStatus || {
        key: 'Active',
        name: 'Active',
      },
      configValue: safeValue,
      externalReferenceCode: String(key || '').toUpperCase(),
    }),
    headers: DEFAULT_REQUEST_HEADERS,
    method: existingConfig != null ? 'PATCH' : 'POST',
  };
  const url = existingConfig
    ? `${OBJECT_ROOT_PATH}/${existingConfig.id}`
    : OBJECT_ROOT_PATH;
  return await fetchJSON(url, options);
};

export const isBase64 = (str) => {
  if (str === '' || str.trim() === '') {
    return false;
  }
  try {
    return btoa(atob(str)) == str;
  } catch {
    return false;
  }
};

export const randomPrefix = () => {
  return Math.random().toString(36).substring(2, 6);
};

export const parsePlaceholderValue = (raw, fallbackMime = 'image/png') => {
  if (!raw) return { base64: '', mimeType: fallbackMime };

  if (raw.trim().startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(raw.trim());
    if (m) return { mimeType: m[1], base64: m[2] };
  }

  try {
    const j = JSON.parse(raw);
    const base64 = j.base64 ?? j.base64Data ?? j.value ?? '';
    const mimeType = j.mimeType ?? fallbackMime;
    return { base64, mimeType };
  } catch {
    return { base64: raw, mimeType: fallbackMime };
  }
};

export const normalizeToJsonPayload = (
  input,
  mimeFallback = 'image/png',
  mimeOverride
) => {
  if (!input) return { mimeType: mimeOverride || mimeFallback, base64: '' };
  const data = parsePlaceholderValue(input, mimeFallback);
  const mimeType = mimeOverride || data.mimeType || mimeFallback;
  return { mimeType, base64: data.base64 || '' };
};
