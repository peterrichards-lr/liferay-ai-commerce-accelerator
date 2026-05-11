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
    id: 'generation-limits',
    label: 'Generation Limits',
    icon: 'code',
    component: lazy(() => import('./components/panels/GenerationLimitsPanel')),
  },
  {
    id: 'categories',
    label: 'Categories',
    icon: 'categories',
    component: lazy(() => import('./components/panels/CategoriesConfigPanel')),
  },
  {
    id: 'exclude-lists',
    label: 'Exclude Lists',
    icon: 'content-shield',
    component: lazy(() => import('./components/panels/ExcludeListsPanel')),
  },
  {
    id: 'batch-sizes',
    label: 'Batch Sizes',
    icon: 'code',
    component: lazy(() => import('./components/panels/BatchSizesPanel')),
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
    component: lazy(
      () => import('./components/panels/ObjectStorageConfigPanel')
    ),
  },
  {
    id: 'websocket',
    label: 'WebSocket',
    icon: 'bolt',
    component: lazy(() => import('./components/panels/WsConfigPanel')),
  },
  {
    id: 'batchpolling',
    label: 'Batch Polling',
    icon: 'change',
    component: lazy(
      () => import('./components/panels/BatchPollingConfigPanel')
    ),
  },
  {
    id: 'workflow-resilience',
    label: 'Workflow Resilience',
    icon: 'time',
    component: lazy(
      () => import('./components/panels/WorkflowResiliencePanel')
    ),
  },
  {
    id: 'cache',
    label: 'Cache',
    icon: 'repository',
    component: lazy(() => import('./components/panels/CacheConfigPanel')),
  },
  {
    id: 'queues',
    label: 'Queues',
    icon: 'list',
    component: lazy(() => import('./components/panels/QueueConfigPanel')),
  },
  {
    id: 'placeholders',
    label: 'Placeholders',
    icon: 'document-image',
    component: lazy(() => import('./components/panels/PlaceholdersPanel')),
  },
];
