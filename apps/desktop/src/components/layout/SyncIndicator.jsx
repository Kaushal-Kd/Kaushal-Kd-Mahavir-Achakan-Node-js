import { formatDateTime } from '@wrs/shared';
import clsx from 'clsx';
import { Cloud, CloudOff, RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  getSyncQueueBlockMessage,
  getSyncQueueEntityLabel,
} from '../../lib/syncQueueEntityLabel.js';
import { syncService } from '../../services/syncService.js';
import { useUIStore } from '../../stores/uiStore.js';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';

const STATES = {
  idle: { label: 'Synced', icon: Cloud, color: 'text-green-600' },
  syncing: { label: 'Syncing', icon: RefreshCw, color: 'text-brand animate-spin' },
  pending: { label: 'Pending', icon: Cloud, color: 'text-yellow-600' },
  offline: { label: 'Offline', icon: WifiOff, color: 'text-red-600' },
  error: { label: 'Error', icon: CloudOff, color: 'text-red-600' },
};

const SyncIndicator = () => {
  const status = useUIStore((s) => s.syncStatus);
  const setStatus = useUIStore((s) => s.setSyncStatus);
  const [syncState, setSyncState] = useState(syncService.getState());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [removeConfirmId, setRemoveConfirmId] = useState(null);
  const [masterPasswords, setMasterPasswords] = useState({});

  useEffect(() => syncService.subscribe(setSyncState), []);

  useEffect(() => {
    if (!syncState.online) setStatus('offline');
    else if (syncState.syncing) setStatus('syncing');
    else if (syncState.failed > 0) setStatus('error');
    else if (syncState.queued > 0) setStatus('pending');
    else setStatus('idle');
  }, [setStatus, syncState.failed, syncState.online, syncState.queued, syncState.syncing]);

  const s = STATES[status] || STATES.idle;
  const Icon = s.icon;
  const entries = syncState.entries || [];
  const countLabel = [
    syncState.failed > 0 ? `${syncState.failed} failed` : null,
    syncState.queued > 0 ? `${syncState.queued} pending` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const retryEntry = async (entry) => {
    if (entry.blockedBy || syncState.syncing || !syncState.online) return;
    setActionId(entry.id);
    try {
      const password = String(masterPasswords[entry.id] || '').trim();
      const needsMasterPassword =
        entry.requiresMasterPassword || /master password/i.test(String(entry.error || ''));
      await syncService.retry(
        entry.id,
        needsMasterPassword && password ? { admin_password: password } : {}
      );
      setMasterPasswords((current) => ({ ...current, [entry.id]: '' }));
    } finally {
      setActionId(null);
    }
  };

  const removeEntry = (id) => {
    if (removeConfirmId !== id) {
      setRemoveConfirmId(id);
      return;
    }
    syncService.remove(id);
    setMasterPasswords((current) => ({ ...current, [id]: '' }));
    setRemoveConfirmId(null);
  };

  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-gray-600 disabled:cursor-default"
        title={
          syncState.lastError
            ? `Sync error: ${syncState.lastError}`
            : entries.length
              ? 'View pending and failed sync items'
              : `Sync status: ${s.label}`
        }
        disabled={!entries.length}
        onClick={() => setDetailsOpen(true)}
      >
        <Icon size={14} className={clsx(s.color)} />
        <span>{countLabel || s.label}</span>
      </button>

      <Modal
        isOpen={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setRemoveConfirmId(null);
        }}
        title="Pending sync items"
        size="md"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
          <span>{syncState.queued || 0} pending</span>
          <span aria-hidden>·</span>
          <span className={syncState.failed ? 'text-red-600 font-medium' : ''}>
            {syncState.failed || 0} failed
          </span>
        </div>

        {entries.length ? (
          <div className="space-y-2">
            {entries.map((entry) => {
              const confirmingRemove = removeConfirmId === entry.id;
              const blockedMessage = getSyncQueueBlockMessage(entry);
              const needsMasterPassword =
                entry.requiresMasterPassword || /master password/i.test(String(entry.error || ''));
              return (
                <div key={entry.id} className="rounded border border-gray-200 bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] font-semibold text-gray-900">
                        {entry.orderNumber || entry.entityId}
                      </span>
                      <p className="mt-0.5 text-[10px] text-gray-500">
                        Queued {formatDateTime(entry.createdAt)} · Attempts {entry.retryCount || 0}
                      </p>
                      <p className="mt-1 text-[10px] text-gray-600">
                        {getSyncQueueEntityLabel(entry.entity)}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        'rounded border px-2 py-0.5 text-[10px] font-medium',
                        entry.status === 'failed'
                          ? 'border-red-200 text-red-700'
                          : 'border-yellow-200 text-yellow-700'
                      )}
                    >
                      {blockedMessage
                        ? 'Blocked'
                        : entry.status === 'failed'
                          ? 'Failed'
                          : 'Pending'}
                    </span>
                  </div>

                  {entry.error ? (
                    <p className="mt-2 text-[11px] text-red-600" title={entry.error}>
                      {entry.error}
                    </p>
                  ) : null}

                  {blockedMessage ? (
                    <p role="status" className="mt-2 text-[11px] text-yellow-700">
                      {blockedMessage} Resolve or retry the earlier action first. Remove it only if
                      you intend to discard that unsynced action.
                    </p>
                  ) : null}

                  {needsMasterPassword ? (
                    <div className="mt-2">
                      <Input
                        label="Master Password for retry"
                        type="password"
                        value={masterPasswords[entry.id] || ''}
                        onChange={(event) =>
                          setMasterPasswords((current) => ({
                            ...current,
                            [entry.id]: event.target.value,
                          }))
                        }
                        hint="Used for this retry only; it is never saved in the sync queue."
                      />
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {confirmingRemove ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemoveConfirmId(null)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={actionId === entry.id}
                      disabled={
                        Boolean(blockedMessage) ||
                        syncState.syncing ||
                        !syncState.online ||
                        (needsMasterPassword && !String(masterPasswords[entry.id] || '').trim())
                      }
                      onClick={() => retryEntry(entry)}
                    >
                      Retry
                    </Button>
                    <Button
                      type="button"
                      variant={confirmingRemove ? 'danger' : 'ghost'}
                      size="sm"
                      disabled={syncState.syncing || Boolean(actionId)}
                      onClick={() => removeEntry(entry.id)}
                    >
                      {confirmingRemove ? 'Confirm remove' : 'Remove'}
                    </Button>
                  </div>
                  {confirmingRemove ? (
                    <p className="mt-2 text-right text-[10px] text-red-600">
                      Removing discards this unsynced item from this device.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-600">No pending or failed sync items.</p>
        )}
      </Modal>
    </>
  );
};

export default SyncIndicator;
