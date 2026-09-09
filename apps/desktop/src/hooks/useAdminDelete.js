import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { getApiErrorMessage } from '../lib/apiError.js';

/**
 * @param {{
 *   deleteFn: (item: unknown, admin_password: string) => Promise<unknown>,
 *   onSuccess?: (data: unknown, item: unknown) => void,
 *   onError?: (err: unknown) => void,
 * }} options
 */
export function useAdminDelete({ deleteFn, onSuccess, onError }) {
  const [target, setTarget] = useState(null);
  const [error, setError] = useState('');

  const deleteMut = useMutation({
    mutationFn: ({ item, admin_password }) => deleteFn(item, admin_password),
    onSuccess: (data, variables) => {
      setTarget(null);
      setError('');
      onSuccess?.(data, variables.item);
    },
    onError: (err) => {
      setError(getApiErrorMessage(err, 'Could not delete'));
      onError?.(err);
    },
  });

  const requestDelete = useCallback((item) => {
    setError('');
    setTarget(item);
  }, []);

  const close = useCallback(() => {
    if (deleteMut.isPending) return;
    setTarget(null);
    setError('');
  }, [deleteMut.isPending]);

  const confirmDelete = useCallback(
    (adminPassword) => {
      if (!target || deleteMut.isPending) return;
      setError('');
      deleteMut.mutate({ item: target, admin_password: adminPassword });
    },
    [target, deleteMut]
  );

  return {
    target,
    requestDelete,
    confirmDelete,
    error,
    clearError: () => setError(''),
    loading: deleteMut.isPending,
    close,
    deleteMut,
  };
}
