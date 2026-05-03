import { useState, useMemo } from 'react';
import {
  getCommerceErrorsMap,
  getGenerationErrorsMap,
} from '../utils/validation';

export default function useValidation(
  config,
  generationConfig,
  liferayConnected,
  generationLimits
) {
  const [connectionErrors, setConnectionErrors] = useState({});

  const commerceErrors = useMemo(() => getCommerceErrorsMap(config), [config]);

  const generationErrors = useMemo(
    () =>
      getGenerationErrorsMap(
        generationConfig,
        liferayConnected,
        generationLimits
      ),
    [generationConfig, liferayConnected, generationLimits]
  );

  return {
    connectionErrors,
    setConnectionErrors,
    commerceErrors,
    generationErrors,
  };
}
