import { APP_SETTINGS_BY_KEY } from '@wrs/shared/constants';
import {
  buildAppSettingsMap,
  getAppSettingValue,
  getGstFromPercentage,
  getNumberSetting,
  parseInvoiceMargin,
  parsePipeNumbers,
  parseYesNo,
} from '@wrs/shared/utils/appSettings.js';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { configurationsApi } from '../lib/api/configurations.js';

/**
 * Loads shop app settings (fixed registry) and exposes typed getters.
 */
export function useAppSettings(options = {}) {
  const query = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => configurationsApi.getAppSettings(),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });

  const items = query.data?.data?.items || [];
  const map = useMemo(() => buildAppSettingsMap(items), [items]);

  const getValue = useCallback((key) => getAppSettingValue(map, key), [map]);

  const isYes = useCallback(
    (key, fallback = 'No') => parseYesNo(getValue(key), fallback),
    [getValue]
  );

  const getNumber = useCallback(
    (key, fallback = 0) => getNumberSetting(map, key, fallback),
    [map]
  );

  const gst = useMemo(() => getGstFromPercentage(map), [map]);

  const getMargin = useCallback(
    (key) => {
      const def = APP_SETTINGS_BY_KEY[key];
      return parseInvoiceMargin(getValue(key), def?.defaultValue);
    },
    [getValue]
  );

  const getPipeNumbers = useCallback(
    (key) => {
      const def = APP_SETTINGS_BY_KEY[key];
      return parsePipeNumbers(getValue(key), def?.defaultValue || '');
    },
    [getValue]
  );

  return {
    query,
    items,
    map,
    isLoading: query.isLoading,
    isYes,
    getValue,
    getNumber,
    getMargin,
    getPipeNumbers,
    gst,
  };
}

export default useAppSettings;
