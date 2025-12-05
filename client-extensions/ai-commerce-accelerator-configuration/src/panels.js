import { lazy } from 'react';

export const PANELS = [
  {
    id: 'ai-config',
    label: 'AI Config',
    icon: 'cog',
    component: lazy(() => import('./components/panels/AiConfigPanel')),
  },
  {
    id: 'ai-prompts',
    label: 'AI Prompts',
    icon: 'chatbot',
    component: lazy(() => import('./components/panels/AiPromptsPanel')),
  },
  {
    id: 'ai-schemas',
    label: 'AI Schemas',
    icon: 'diagram',
    component: lazy(() => import('./components/panels/AiSchemasPanel')),
  },
  {
    id: 'queues',
    label: 'Queues',
    icon: 'list',
    component: lazy(() => import('./components/panels/QueueConfigPanel')),
  },
  {
    id: 'batchpolling',
    label: 'Batch Polling',
    icon: 'change',
    component: lazy(() => import('./components/panels/BatchPollingConfigPanel')),
  },
  {
    id: 'websocket',
    label: 'WebSocket',
    icon: 'bolt',
    component: lazy(() => import('./components/panels/WsConfigPanel')),
  },
  {
    id: 'cache',
    label: 'Cache',
    icon: 'repository',
    component: lazy(() => import('./components/panels/CacheConfigPanel')),
  },
  {
    id: 'oauth',
    label: 'OAuth',
    icon: 'lock',
    component: lazy(() => import('./components/panels/OAuthConfigPanel')),
  },
  {
    id: 'objectstorage',
    label: 'Object Storage',
    icon: 'cloud',
    component: lazy(() => import('./components/panels/ObjectStorageConfigPanel')),
  },
  {
    id: 'placeholders',
    label: 'Placeholders',
    icon: 'document-image',
    component: lazy(() => import('./components/panels/PlaceholdersPanel')),
  },
  {
    id: 'categories',
    label: 'Categories',
    icon: 'categories',
    component: lazy(() => import('./components/panels/CategoriesConfigPanel')),
  },
];
