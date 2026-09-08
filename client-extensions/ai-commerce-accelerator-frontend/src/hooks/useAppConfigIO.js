import { useCallback } from 'react';
import notifyUser from '../utils/notifications';
import { buildFilename, exportJsonFile } from '../utils/fileHelper';
import {
  RESOLVED_BY_NAME,
  UNRESOLVED,
  describeResolution,
  resolveImportedReference,
} from '../config/importedReferences';

export default function useAppConfigIO({
  config,
  setConfig,
  generationConfig,
  setGenerationConfig,
  connectionEstablished,
  setConnectionEstablished,
  setOpenAiKeyAvailable,
  setAiMediaKeyAvailable,
  availableCategories,
  catalogs = [],
  channels = [],
  mountedRef,
  selectChannel,
}) {
  const exportConfiguration = useCallback(() => {
    const selectedCatalog = catalogs.find(
      (catalog) => String(catalog.id) === String(config.catalogId)
    );
    const selectedChannel = channels.find(
      (channel) => String(channel.id) === String(config.channelId)
    );

    const exportData = {
      liferayUrl: config.liferayUrl,
      microserviceUrl: config.microserviceUrl,
      batchSize: config.batchSize,
      aiModel: config.aiModel,
      currencyCode: config.currencyCode,
      localeCode: config.localeCode,
      selectedLanguages: config.selectedLanguages,
      catalogId: config.catalogId,
      catalogName: selectedCatalog?.name,
      channelId: config.channelId,
      channelName: selectedChannel?.name,
      generationConfig: generationConfig,
      exportedAt: new Date().toISOString(),
    };

    const filename = buildFilename('ai-commerce-accelerator-config');
    exportJsonFile(exportData, filename);

    notifyUser('Configuration exported successfully');
  }, [config, generationConfig, catalogs, channels]);

  const importConfiguration = useCallback(
    (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const importedData = JSON.parse(e.target.result);

          const fieldsToValidate = ['liferayUrl', 'clientId', 'clientSecret'];
          const missingFields = [];

          fieldsToValidate.forEach((field) => {
            const val = importedData[field];
            const empty =
              val == null || (typeof val === 'string' && val.trim() === '');
            if (
              Object.prototype.hasOwnProperty.call(importedData, field) &&
              empty
            ) {
              missingFields.push(field);
            }
          });

          if (missingFields.length > 0) {
            notifyUser(
              `Invalid values for: ${missingFields.join(', ')}`,
              'danger'
            );
            return;
          }

          const connectionParamsWillChange =
            (Object.prototype.hasOwnProperty.call(importedData, 'liferayUrl') &&
              config.liferayUrl !== importedData.liferayUrl) ||
            (Object.prototype.hasOwnProperty.call(importedData, 'clientId') &&
              config.clientId !== importedData.clientId) ||
            (Object.prototype.hasOwnProperty.call(
              importedData,
              'clientSecret'
            ) &&
              config.clientSecret !== importedData.clientSecret);

          const allowedConfigFields = [
            'liferayUrl',
            'microserviceUrl',
            'clientId',
            'clientSecret',
            'batchSize',
            'aiModel',
            'currencyCode',
            'selectedLanguages',
            'catalogId',
            'channelId',
            'reactLoggingLevel',
            'wsLoggingLevel',
          ];

          const newConfig = { ...config };
          allowedConfigFields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(importedData, field)) {
              newConfig[field] = importedData[field];
            }
          });

          const applyImportedReference = ({
            label,
            idField,
            nameField,
            items,
          }) => {
            const id = importedData[idField];
            const name = importedData[nameField];

            const { item, outcome } = resolveImportedReference({
              items,
              id,
              name,
            });

            const notice = describeResolution({
              label,
              outcome,
              item,
              id,
              name,
            });
            if (notice) notifyUser(notice.message, notice.type);

            if (outcome === RESOLVED_BY_NAME) newConfig[idField] = item.id;
            if (outcome === UNRESOLVED) newConfig[idField] = null;

            return outcome;
          };

          applyImportedReference({
            label: 'Catalog',
            idField: 'catalogId',
            nameField: 'catalogName',
            items: catalogs,
          });

          const channelOutcome = applyImportedReference({
            label: 'Channel',
            idField: 'channelId',
            nameField: 'channelName',
            items: channels,
          });

          setConfig(newConfig);

          // selectChannel has to run after setConfig, not before it: it derives
          // siteGroupId, the languages and the currency from the channel, and
          // newConfig still carries the values the previous channel left behind.
          // The imported languages and currency are handed over explicitly so
          // that neither call depends on the other overwriting it.
          try {
            if (newConfig.channelId != null) {
              await selectChannel(newConfig.channelId, {
                selectedLanguages: newConfig.selectedLanguages,
                currencyCode: newConfig.currencyCode,
              });
            } else if (channelOutcome === UNRESOLVED) {
              await selectChannel(null);
            }
          } catch (channelError) {
            notifyUser(
              'The imported configuration was applied, but the channel could not be loaded.',
              'warning',
              channelError
            );
          }

          if (importedData.generationConfig) {
            setGenerationConfig((prevConfig) => {
              const importedGenConfig = importedData.generationConfig;

              // Filter out any nulls or empty strings from imported list
              let newCategories = (importedGenConfig.categories || [])
                .filter((cat) => cat != null && cat !== '')
                .map(String);

              // If we have categories loaded from the server, validate against them
              if (availableCategories && availableCategories.length > 0) {
                const availableCategoryNames = new Set(
                  availableCategories.map((c) =>
                    typeof c === 'string' ? c : c.key
                  )
                );

                const validImportedCategories = newCategories.filter((cat) =>
                  availableCategoryNames.has(cat)
                );

                const unavailableCategories = newCategories.filter(
                  (cat) => !availableCategoryNames.has(cat)
                );

                if (unavailableCategories.length > 0) {
                  notifyUser(
                    `Some imported categories are not available in the current Liferay instance: ${Array.from(
                      new Set(unavailableCategories)
                    ).join(
                      ', '
                    )}. These categories have been removed from the configuration.`,
                    'warning'
                  );
                }

                // If no valid categories were found in the import, use the first available from server
                if (validImportedCategories.length === 0) {
                  const defaultCat =
                    typeof availableCategories[0] === 'string'
                      ? availableCategories[0]
                      : availableCategories[0].key;

                  validImportedCategories.push(defaultCat);
                  notifyUser(
                    `No valid categories were imported, defaulting to '${defaultCat}'.`,
                    'info'
                  );
                }

                newCategories = validImportedCategories;
              }

              return {
                ...prevConfig,
                ...importedGenConfig,
                categories: newCategories,
              };
            });
          }

          if (connectionParamsWillChange) {
            if (mountedRef.current) setConnectionEstablished(false);
            if (mountedRef.current) setOpenAiKeyAvailable(false);
            if (mountedRef.current) setAiMediaKeyAvailable(false);

            notifyUser(
              'Configuration imported successfully. Please test connection with new parameters.'
            );
          } else {
            notifyUser(
              connectionEstablished
                ? 'Configuration imported successfully! Connection maintained.'
                : 'Configuration imported successfully.'
            );
          }
        } catch (error) {
          notifyUser(
            'Failed to import configuration. Invalid JSON file.',
            'danger',
            error
          );
        }
      };

      reader.readAsText(file);
      event.target.value = '';
    },
    [
      config,
      setConfig,
      connectionEstablished,
      setGenerationConfig,
      availableCategories,
      catalogs,
      channels,
      mountedRef,
      selectChannel,
      setConnectionEstablished,
      setOpenAiKeyAvailable,
      setAiMediaKeyAvailable,
    ]
  );

  return { exportConfiguration, importConfiguration };
}
