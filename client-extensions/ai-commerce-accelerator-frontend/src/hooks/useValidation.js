import { useState, useMemo } from 'react';
import {
  getCommerceErrorsMap,
  getGenerationErrorsMap,
} from '../utils/validation';

export default function useValidation(
  config,
  generationConfig,
  liferayConnected
) {
  const [connectionErrors, setConnectionErrors] = useState({});

  const commerceErrors = useMemo(() => getCommerceErrorsMap(config), [config]);

  const generationErrors = useMemo(
    () => getGenerationErrorsMap(generationConfig, liferayConnected),
    [generationConfig, liferayConnected]
  );

  return {
    connectionErrors,
    setConnectionErrors,
    commerceErrors,
    generationErrors,
  };
}
