import { useQuery } from '@tanstack/react-query';
import { normalizeLaundryPrioritySettings } from '@wrs/shared';

import { configurationsApi } from '../lib/api/configurations.js';

export function useLaundryPrioritySettings() {
  const { data, isLoading } = useQuery({
    queryKey: ['config-laundry-priority'],
    queryFn: () => configurationsApi.getLaundryPriority(),
  });

  return {
    settings: normalizeLaundryPrioritySettings(data?.data),
    isLoading,
  };
}
