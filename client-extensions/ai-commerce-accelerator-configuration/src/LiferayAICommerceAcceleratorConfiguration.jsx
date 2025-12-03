import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import ClayLayout from '@clayui/layout';
import LeftNav from './components/LeftNav';
import GlobalDisclaimer from './components/common/GlobalDisclaimer';

const AiConfigPanel = lazy(() => import('./components/panels/AiConfigPanel'));
const QueueConfigPanel = lazy(() =>
  import('./components/panels/QueueConfigPanel')
);
const BatchPollingConfigPanel = lazy(() =>
  import('./components/panels/BatchPollingConfigPanel')
);
const WsConfigPanel = lazy(() => import('./components/panels/WsConfigPanel'));
const CacheConfigPanel = lazy(() =>
  import('./components/panels/CacheConfigPanel')
);
const OAuthConfigPanel = lazy(() =>
  import('./components/panels/OAuthConfigPanel')
);
const ObjectStorageConfigPanel = lazy(() =>
  import('./components/panels/ObjectStorageConfigPanel')
);
const PlaceholdersPanel = lazy(() =>
  import('./components/panels/PlaceholdersPanel')
);
const AiSchemasPanel = lazy(() =>
  import('./components/panels/AiSchemasPanel')
);

const APP_NAME = 'Liferay Commerce AI Generator';
const STORAGE_KEY = 'ai-config-active-tab';

const TABS = [
  { id: 'ai', label: 'AI & Prompts', icon: 'cog' },
  { id: 'ai-schemas', label: 'AI Schemas', icon: 'diagram' },
  { id: 'queues', label: 'Queues', icon: 'list' },
  { id: 'batchpolling', label: 'Batch Polling', icon: 'change' },
  { id: 'websocket', label: 'WebSocket', icon: 'bolt' },
  { id: 'cache', label: 'Cache', icon: 'repository' },
  { id: 'oauth', label: 'OAuth', icon: 'lock' },
  { id: 'objectstorage', label: 'Object Storage', icon: 'cloud' },
  { id: 'placeholders', label: 'Placeholders', icon: 'document-image' },
];

const PANEL_MAP = {
  ai: AiConfigPanel,
  'ai-schemas': AiSchemasPanel,
  queues: QueueConfigPanel,
  batchpolling: BatchPollingConfigPanel,
  websocket: WsConfigPanel,
  cache: CacheConfigPanel,
  oauth: OAuthConfigPanel,
  objectstorage: ObjectStorageConfigPanel,
  placeholders: PlaceholdersPanel,
};

export default function LiferayAICommerceAcceleratorConfiguration() {
  const initialFromHash =
    typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
  const initialFromStorage =
    typeof window !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) || ''
      : '';

  const validIds = useMemo(() => new Set(TABS.map((t) => t.id)), []);
  const defaultId = TABS[0].id;

  const initial = useMemo(() => {
    if (validIds.has(initialFromHash)) return initialFromHash;
    if (validIds.has(initialFromStorage)) return initialFromStorage;
    return defaultId;
  }, [initialFromHash, initialFromStorage, validIds]);

  const [activeId, setActiveId] = useState(initial);

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  useEffect(() => {
    const id = validIds.has(activeId) ? activeId : defaultId;
    if (id !== activeId) setActiveId(defaultId);
    try {
      window.history.replaceState(null, '', `#${id}`);
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
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

  const ActivePanel = PANEL_MAP[activeId] || (() => null);
  const activeLabel = TABS.find((t) => t.id === activeId)?.label || 'Panel';

  return (
    <ClayLayout.ContainerFluid className="container-view">
      <div className="row">
        <LeftNav
          header="Configuration"
          items={TABS}
          activeId={activeId}
          onSelect={setActiveId}
        />
        <ClayLayout.Col size={9}>
          <GlobalDisclaimer
            text="This configuration is intended for demonstrations and internal testing only. Do not use in production."
            localStorageKey="aiCommerceAcceleratorConfigurationDisclaimerDismissed"
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
