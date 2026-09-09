import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { createChecklistCommandSubmitter, findPendingChecklistCommand } from '../../lib/checklistCommand.js';
import { queryClient } from '../../lib/queryClient.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { syncService } from '../../services/syncService.js';
import { useOnlineStatus } from '../useOnlineStatus.js';

export const submitChecklistCommand = createChecklistCommandSubmitter({
  queue: syncService,
  afterSave: async (orderId, order) => {
    queryClient.setQueryData(['order', orderId], order);
    await invalidateOrderDomain(queryClient, { orderId });
    await queryClient.invalidateQueries({ queryKey: ['security-charges'] });
    await queryClient.invalidateQueries({ queryKey: ['reports'] });
  },
});

export function usePendingChecklistCommands() {
  const [entries, setEntries] = useState(() => syncService.getEntries().filter((entry) => entry.entity === 'checklist_command'));
  useEffect(() => syncService.subscribe((snapshot) => {
    setEntries(snapshot.entries.filter((entry) => entry.entity === 'checklist_command'));
  }), []);
  return entries;
}

export function useChecklistCommand(orderId) {
  const entries = usePendingChecklistCommands();
  const isOnline = useOnlineStatus();
  const mutation = useMutation({ mutationFn: (options) => submitChecklistCommand(orderId, options) });
  return { submit: mutation.mutateAsync, pendingEntry: findPendingChecklistCommand(entries, orderId), isOnline };
}
