import React, { useState } from 'react';
import ClayCard from '@clayui/card';
import ClayForm, { ClayInput } from '@clayui/form';
import { useApp } from '../../context/AppContext';
import FieldError from '../ui/FieldError';
import { getConfigurationSourceErrorsMap } from '../../utils/validation';

/**
 * Where AICA reads its own configuration, as opposed to where it writes data.
 *
 * One collapsed row rather than a second card, per #903 §2.1: ninety-nine runs
 * in a hundred have one Liferay, and the second connection should cost a line
 * of reading rather than a card's worth of screen. Expanding it is the act of
 * saying the two differ.
 *
 * It asks for a client id and a secret, not an OAuth ERC. #903's first
 * correction settled that: resolving an ERC goes through
 * `lxcConfig.oauthApplication`, which reads Liferay's routes tree, and the
 * split topology this row exists for is exactly where there is no tree.
 */
export default function ConfigurationSourceCard({ disabled = false }) {
  const { config, setConfig } = useApp();
  const enabled = !!config.configSourceEnabled;
  const [errors, setErrors] = useState({});

  const update = (patch) => {
    const next = { ...config, ...patch };
    setConfig(patch);
    setErrors(getConfigurationSourceErrorsMap(next));
  };

  const toggle = () => {
    // Collapsing clears the fields rather than hiding them. A URL still in
    // state but no longer on screen is the shape of every silent-substitution
    // bug on this issue: a value applying that nobody can see.
    update(
      enabled
        ? {
            configSourceEnabled: false,
            configSourceUrl: '',
            configSourceClientId: '',
            configSourceClientSecret: '',
          }
        : { configSourceEnabled: true }
    );
  };

  return (
    <ClayCard className="p-4">
      <div className="d-flex align-items-center justify-content-between">
        <h3 className="mb-0" style={{ fontSize: '1rem' }}>
          Configuration source
        </h3>
        <button
          aria-expanded={enabled}
          className="btn btn-sm btn-unstyled text-primary"
          disabled={disabled}
          onClick={toggle}
          type="button"
        >
          {enabled ? 'Use the target instance' : 'Use a different instance'}
        </button>
      </div>

      {!enabled && (
        <small className="form-text text-muted mt-1">
          Same as target. AICA reads its AI settings, prompts and chunk sizes
          from the instance it writes data to.
        </small>
      )}

      {enabled && (
        <>
          <small className="form-text text-muted mt-1 mb-3">
            AICA reads its AI settings, prompts and chunk sizes from this
            instance and writes commerce data to the target. A different
            instance needs its own OAuth client — the target&apos;s credentials
            are not valid there.
          </small>

          <ClayForm.Group>
            <label className="form-label" htmlFor="configSourceUrl">
              Configuration Liferay URL <span className="text-danger">*</span>
            </label>
            <ClayInput
              aria-label="Configuration Liferay URL"
              autoComplete="off"
              disabled={disabled}
              id="configSourceUrl"
              onChange={(e) => update({ configSourceUrl: e.target.value })}
              placeholder="http://localhost:8080"
              value={config.configSourceUrl || ''}
            />
            <FieldError errors={errors.configSourceUrl} />
          </ClayForm.Group>

          <div
            className="grid"
            style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            <ClayForm.Group>
              <label className="form-label" htmlFor="configSourceClientId">
                Client ID <span className="text-danger">*</span>
              </label>
              <ClayInput
                aria-label="Configuration source Client ID"
                autoComplete="off"
                disabled={disabled}
                id="configSourceClientId"
                onChange={(e) =>
                  update({ configSourceClientId: e.target.value })
                }
                value={config.configSourceClientId || ''}
              />
              <FieldError errors={errors.configSourceClientId} />
            </ClayForm.Group>
            <ClayForm.Group>
              <label className="form-label" htmlFor="configSourceClientSecret">
                Client Secret <span className="text-danger">*</span>
              </label>
              <ClayInput
                aria-label="Configuration source Client Secret"
                autoComplete="off"
                disabled={disabled}
                id="configSourceClientSecret"
                onChange={(e) =>
                  update({ configSourceClientSecret: e.target.value })
                }
                type="password"
                value={config.configSourceClientSecret || ''}
              />
              <FieldError errors={errors.configSourceClientSecret} />
            </ClayForm.Group>
          </div>

          <small className="form-text text-muted">
            The secret is never written to an exported configuration file. A
            saved configuration names the instance and the client id, and is not
            a secret-bearing document.
          </small>
        </>
      )}
    </ClayCard>
  );
}
