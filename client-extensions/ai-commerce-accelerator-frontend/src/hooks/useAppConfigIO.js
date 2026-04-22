import { useCallback } from 'react';
import notifyUser from '../utils/notifications';
import { buildFilename, exportJsonFile } from '../utils/fileHelper';

export default function useAppConfigIO({
  config,
  setConfig,
  generationConfig,
  setGenerationConfig,
  connectionEstablished,
  setConnectionEstablished,
  setOpenAiKeyAvailable,
  availableCategories,
  mountedRef,
  selectChannel,
}) {
  const exportConfiguration = useCallback(() => {
    const exportData = {
      liferayUrl: config.liferayUrl,
      microserviceUrl: config.microserviceUrl,
      batchSize: config.batchSize,
      aiModel: config.aiModel,
      currencyCode: config.currencyCode,
      localeCode: config.localeCode,
      selectedLanguages: config.selectedLanguages,
      catalogId: config.catalogId,
      channelId: config.channelId,
      generationConfig: generationConfig,
      exportedAt: new Date().toISOString(),
    };

    const filename = buildFilename('ai-commerce-accelerator-config');
    exportJsonFile(exportData, filename);

    notifyUser('Configuration exported successfully');
  }, [config, generationConfig]);

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

          if (newConfig.channelId != null) {
            await selectChannel(newConfig.channelId, {
              selectedLanguages: newConfig.selectedLanguages,
              currencyCode: newConfig.currencyCode,
            });
          }

          setConfig(newConfig);

          if (importedData.generationConfig) {
            setGenerationConfig((prevConfig) => {
              const importedGenConfig = importedData.generationConfig;
              let newCategories = importedGenConfig.categories || [];
              const availableCategoryNames = new Set(
                availableCategories.map((c) => c.key)
              );

              const validImportedCategories = newCategories.filter((cat) =>
                availableCategoryNames.has(cat)
              );

              const unavailableCategories = newCategories.filter(
                (cat) => !availableCategoryNames.has(cat)
              );

              if (unavailableCategories.length > 0) {
                notifyUser(
                  `Some imported categories are not available in the current Liferay instance: ${unavailableCategories.join(
                    ', '
                  )}. These categories have been removed from the configuration.`,
                  'warning'
                );
              }

              if (
                validImportedCategories.length === 0 &&
                availableCategories.length > 0
              ) {
                validImportedCategories.push(availableCategories[0].key);
                notifyUser(
                  `No valid categories were imported, defaulting to '${availableCategories[0].key}'.`,
                  'info'
                );
              }

              return {
                ...prevConfig,
                ...importedGenConfig,
                categories: validImportedCategories,
              };
            });
          }

          if (connectionParamsWillChange) {
            if (mountedRef.current) setConnectionEstablished(false);
            if (mountedRef.current) setOpenAiKeyAvailable(false);

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
      mountedRef,
      selectChannel,
      setConnectionEstablished,
      setOpenAiKeyAvailable,
    ]
  );

  return { exportConfiguration, importConfiguration };
}
