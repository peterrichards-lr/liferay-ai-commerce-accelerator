import React, { useEffect, useMemo, useState } from 'react';
import ClayLayout from '@clayui/layout';
import LeftNav from './components/LeftNav';
import OpenAISettingsPanel from './components/panels/OpenAISettingsPanel';
import BatchPollingConfigPanel from './components/panels/BatchPollingConfigPanel';
import PlaceholdersPanel from './components/panels/PlaceholdersPanel';
import GlobalDisclaimer from './components/common/GlobalDisclaimer';

const APP_NAME = 'Liferay Commerce AI Generator';
const STORAGE_KEY = 'ai-config-active-tab';

const TABS = [
  { id: 'openai', label: 'OpenAI', icon: 'api-web' },
  { id: 'batchpolling', label: 'Batch Polling', icon: 'change' },
  { id: 'placeholders', label: 'Placeholders', icon: 'document-image' },
];

export default function LiferayAICommerceAcceleratorConfiguration() {
  const initialFromHash =
    typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
  const initialFromStorage =
    typeof window !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY) || ''
      : '';

  const initial = useMemo(() => {
    if (TABS.some((t) => t.id === initialFromHash)) return initialFromHash;
    if (TABS.some((t) => t.id === initialFromStorage))
      return initialFromStorage;
    return TABS[0].id;
  }, [initialFromHash, initialFromStorage]);

  const [activeId, setActiveId] = useState(initial);

  useEffect(() => {
    document.title = APP_NAME;
  }, []);
  useEffect(() => {
    try {
      window.history.replaceState(null, '', `#${activeId}`);
    } catch {}
    try {
      localStorage.setItem(STORAGE_KEY, activeId);
    } catch {}
  }, [activeId]);
  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace('#', '');
      if (TABS.some((t) => t.id === id)) setActiveId(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const renderActivePanel = () => {
    switch (activeId) {
      case 'openai':
        return <OpenAISettingsPanel />;
      case 'batchpolling':
        return <BatchPollingConfigPanel />;
      case 'placeholders':
        return <PlaceholdersPanel />;
      default:
        return null;
    }
  };

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

          {/* Hidden heading to label the region for screen readers */}
          <h2 id={`tab-${activeId}`} className="sr-only">
            {activeLabel}
          </h2>
          <section role="region" aria-labelledby={`tab-${activeId}`}>
            {renderActivePanel()}
          </section>
        </ClayLayout.Col>
      </div>
    </ClayLayout.ContainerFluid>
  );
}
