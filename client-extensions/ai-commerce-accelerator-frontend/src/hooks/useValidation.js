import { useState, useMemo } from 'react';
import {
  getConnectionErrorsMap,
  getCommerceErrorsMap,
  getGenerationErrorsMap,
} from '../utils/validation';

export default function useValidation(config, generationConfig) {
  const [connectionErrors, setConnectionErrors] = useState({});

  const commerceErrors = useMemo(() => getCommerceErrorsMap(config), [config]);

  const generationErrors = useMemo(
    () => getGenerationErrorsMap(generationConfig),
    [generationConfig]
  );

  return {
    connectionErrors,
    setConnectionErrors,
    commerceErrors,
    generationErrors,
  };
}
