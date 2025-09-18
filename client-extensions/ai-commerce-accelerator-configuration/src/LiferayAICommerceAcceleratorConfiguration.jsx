import { useState } from 'react';
import Breadcrumb from '@clayui/breadcrumb';
import ClayLayout from '@clayui/layout';

import LeftNav from './components/LeftNav';
import GlobalDisclaimer from './components/common/GlobalDisclaimer';
import OpenAISettingsPanel from './components/panels/OpenAISettingsPanel';
import PlaceholdersPanel from './components/panels/PlaceholdersPanel';
import BatchPollingConfigPanel from './components/panels/BatchPollingConfigPanel';

const TABS = [
  { id: 'openai', label: 'Open AI', icon: 'api-web' },
  { id: 'batchpolling', label: 'Batch Polling', icon: 'change' },
  { id: 'placeholders', label: 'Default Placeholders', icon: 'document-image' },
];

const APP_NAME = 'Liferay Commerce AI Generator';

export default function LiferayCommerceAiGeneratorConfiguration() {
  const [activeId, setActiveId] = useState(TABS[0].id);

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

  document.title = APP_NAME;

  return (
    <>
      <ClayLayout.ContainerFluid>
        <ClayLayout.Col size={12}>
          <Breadcrumb
            items={[
              {
                href: '#1',
                label: `${APP_NAME} Configuration`,
              },
            ]}
          />
        </ClayLayout.Col>
      </ClayLayout.ContainerFluid>

      <ClayLayout.ContainerFluid>
        <ClayLayout.Row justify="start">
          <LeftNav items={TABS} activeId={activeId} onSelect={setActiveId} />

          <ClayLayout.Col size={9}>
            <GlobalDisclaimer />
            {renderActivePanel()}
          </ClayLayout.Col>
        </ClayLayout.Row>
      </ClayLayout.ContainerFluid>
    </>
  );
}
