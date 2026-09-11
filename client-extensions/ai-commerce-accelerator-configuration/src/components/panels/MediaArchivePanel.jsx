import { useEffect, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';

const ARCHIVE_KEY = 'media-archive-config';

const DEFAULTS = {
  [ARCHIVE_KEY]: {
    maxSessions: 10,
    retain: true,
    retentionHours: 72,
  },
};

function toInt(value, fallback) {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function MediaArchivePanel() {
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [ARCHIVE_KEY]: values },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [ARCHIVE_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

  const setField = (key, value) =>
    setValue(ARCHIVE_KEY, { ...values, [key]: value });

  useEffect(() => {
    const found = [];
    const { maxSessions, retentionHours } = values;

    // Rejected rather than clamped: a retention of zero reads as "keep
    // nothing", and a typo that silently became "delete every package source
    // on the next run" is not a setting anyone should be able to save by
    // accident.
    if (!Number.isFinite(retentionHours) || retentionHours < 1) {
      found.push('Retention must be a whole number of hours, at least 1.');
    }

    if (!Number.isFinite(maxSessions) || maxSessions < 1) {
      found.push('Runs kept must be a whole number, at least 1.');
    }

    setIssues(found);
  }, [values]);

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Media Archive</h2>
        <div className="sheet-text">
          How long a run&apos;s images and attachments stay on disk. This is
          what decides whether a finished run can still be exported as a
          package: once its media is pruned, the only way to rebuild one is to
          extract from the instance that holds it. Stored under{' '}
          <code>{ARCHIVE_KEY}</code>.
        </div>
      </div>

      {!!issues.length && (
        <ClayAlert
          displayType="warning"
          title="Please review"
          role="alert"
          aria-live="assertive"
          className="mb-3"
        >
          <ul className="my-2">
            {issues.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </ClayAlert>
      )}

      <div className="sheet-section">
        <ClayForm.Group>
          <label htmlFor="retention-hours" className="font-weight-semi-bold">
            Keep media for (hours)
          </label>
          <ClayInput
            id="retention-hours"
            type="number"
            min={1}
            step={1}
            value={values.retentionHours}
            onChange={(event) =>
              setField(
                'retentionHours',
                toInt(event.target.value, values.retentionHours)
              )
            }
          />
          <small className="form-text text-secondary">
            Three days covers a weekend, which is the point: a run stays
            packageable long enough to be promoted on Monday. Longer windows
            cost disk; shorter ones mean re-reading the instance.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="max-sessions" className="font-weight-semi-bold">
            Runs kept
          </label>
          <ClayInput
            id="max-sessions"
            type="number"
            min={1}
            step={1}
            value={values.maxSessions}
            onChange={(event) =>
              setField(
                'maxSessions',
                toInt(event.target.value, values.maxSessions)
              )
            }
          />
          <small className="form-text text-secondary">
            A cap behind the window, because a single busy day can fill a volume
            well inside it. The run in progress is never pruned.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <div className="custom-control custom-checkbox mb-3">
            <input
              type="checkbox"
              className="custom-control-input"
              id="retain-staging"
              checked={values.retain !== false}
              onChange={(event) => setField('retain', event.target.checked)}
            />
            <label className="custom-control-label" htmlFor="retain-staging">
              Keep media staged while building a package
            </label>
          </div>
          <small className="form-text text-secondary">
            An extract from a live instance stages what it downloads. With this
            on, that staging is kept and pruned on the schedule above. With it
            off, it is deleted as soon as the package has been produced —
            cheaper on disk, and the next extract pays for the download again.
            Media belonging to a run is unaffected either way.
          </small>
        </ClayForm.Group>
      </div>

      <div className="sheet-section">
        <ClayAlert displayType="info" title="Set where it is deployed">
          The directory itself is not configurable from here. It is a path on
          the machine running the microservice — <code>MEDIA_ARCHIVE_PATH</code>
          , defaulting to <code>~/.aica/media</code> beside the workflow
          database — and a form that reaches that machine from another one has
          no business naming directories on it.
        </ClayAlert>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={!dirty || saving || issues.length > 0}
            aria-disabled={!dirty || saving || issues.length > 0}
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
            aria-disabled={!dirty || saving}
          >
            Cancel
          </ClayButton>
        </div>
      </div>
    </ClayLayout.Sheet>
  );
}
