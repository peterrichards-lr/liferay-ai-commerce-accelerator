import React, { Suspense, useEffect, useMemo, useState } from 'react';
import ClayLayout from '@clayui/layout';
import LeftNav from './components/LeftNav';
import GlobalDisclaimer from './components/common/GlobalDisclaimer';
import { PANELS } from './panels';

const APP_NAME = 'Liferay Commerce AI Generator';
const STORAGE_KEY = 'aica_config_active_tab';

export default function LiferayAICommerceAcceleratorConfiguration() {
  const initialFromHash =
    typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
  const initialFromStorage =
    typeof window !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) || ''
      : '';

  const validIds = useMemo(() => new Set(PANELS.map((p) => p.id)), []);
  const defaultId = PANELS[0].id;

  const initial = useMemo(() => {
    if (validIds.has(initialFromHash)) return initialFromHash;
    if (validIds.has(initialFromStorage)) return initialFromStorage;
    return defaultId;
  }, [initialFromHash, initialFromStorage, validIds, defaultId]);

  const [activeId, setActiveId] = useState(initial);

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  useEffect(() => {
    const id = validIds.has(activeId) ? activeId : defaultId;
    if (id !== activeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveId(defaultId);
    }
    try {
      window.history.replaceState(null, '', `#${id}`);
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Ignore storage errors
    }
  }, [activeId, defaultId, validIds]);

  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace('#', '');
      if (validIds.has(id)) setActiveId(id);
      else setActiveId(defaultId);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [defaultId, validIds]);

  const activePanelInfo = useMemo(
    () => PANELS.find((p) => p.id === activeId) || PANELS[0],
    [activeId]
  );

  const ActivePanel = activePanelInfo.component;
  const activeLabel = activePanelInfo.label;

  return (
    <ClayLayout.ContainerFluid className="container-view">
      <div className="row">
        <LeftNav
          header="Configuration"
          items={PANELS}
          activeId={activeId}
          onSelect={setActiveId}
        />
        <ClayLayout.Col size={9}>
          <GlobalDisclaimer
            text="This configuration is intended for demonstrations and internal testing only. Do not use in production."
            localStorageKey="aica_configuration_disclaimer_dismissed"
          />
          <h2 id={`tab-${activeId}`} className="sr-only">
            {activeLabel}
          </h2>
          <section role="region" aria-labelledby={`tab-${activeId}`}>
            <Suspense fallback={<div aria-busy="true">Loading…</div>}>
              <ActivePanel />
            </Suspense>
          </section>
        </ClayLayout.Col>
      </div>
    </ClayLayout.ContainerFluid>
  );
}
