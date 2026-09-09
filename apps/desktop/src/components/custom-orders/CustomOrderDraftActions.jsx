import { formatDateTime } from '@wrs/shared';
import { ClipboardList, FilePlus2, Save, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Button from '../ui/Button.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import Modal from '../ui/Modal.jsx';
import {
  getActiveDraftId,
  readDraftList,
  removeCustomOrderDraft,
  setActiveDraftId,
} from '../../lib/customOrderDraftStorage.js';
import { toast } from '../../stores/uiStore.js';

function formatDraftSavedTime(updatedAt) {
  if (!updatedAt) return '';
  return formatDateTime(updatedAt) || '';
}

const CustomOrderDraftActions = ({
  mode,
  activeDraftId,
  draftSavedTimeLabel,
  onSaveDraft,
  onNewDraft,
  onResumeDraft,
  onDeleteDraft,
}) => {
  const navigate = useNavigate();
  const [draftsModalOpen, setDraftsModalOpen] = useState(false);
  const [draftToDelete, setDraftToDelete] = useState(null);
  const [draftListTick, setDraftListTick] = useState(0);

  const navigateActiveDraftId = mode === 'navigate' ? getActiveDraftId() : null;

  const navigateSavedTimeLabel = useMemo(() => {
    if (mode !== 'navigate') return '';
    const activeId = getActiveDraftId();
    if (!activeId) return '';
    const row = readDraftList().find((d) => d.id === activeId);
    return formatDraftSavedTime(row?.updatedAt);
  }, [mode, draftListTick, draftsModalOpen]);

  const storedDraftsSorted = useMemo(() => {
    const rows = readDraftList();
    return [...rows].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }, [draftListTick, draftsModalOpen]);

  const displayActiveDraftId = mode === 'embedded' ? activeDraftId : navigateActiveDraftId;
  const displaySavedTimeLabel =
    mode === 'embedded' ? draftSavedTimeLabel : navigateSavedTimeLabel;

  const handleSaveDraft = useCallback(() => {
    if (mode === 'embedded') {
      onSaveDraft?.();
      return;
    }
    navigate('/custom-orders/new', { state: { manualSaveDraft: Date.now() } });
  }, [mode, navigate, onSaveDraft]);

  const handleNewDraft = useCallback(() => {
    if (mode === 'embedded') {
      onNewDraft?.();
      return;
    }
    navigate('/custom-orders/new', { state: { startNewDraft: Date.now() } });
  }, [mode, navigate, onNewDraft]);

  const handleResumeDraft = useCallback(
    (row) => {
      if (!row?.id) return;
      if (mode === 'embedded') {
        onResumeDraft?.(row);
        setDraftsModalOpen(false);
        setDraftListTick((t) => t + 1);
        return;
      }
      setActiveDraftId(row.id);
      setDraftsModalOpen(false);
      setDraftListTick((t) => t + 1);
      navigate('/custom-orders/new');
    },
    [mode, navigate, onResumeDraft]
  );

  const handleDeleteDraft = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      if (mode === 'embedded') {
        onDeleteDraft?.(sid);
        setDraftListTick((t) => t + 1);
        return;
      }
      removeCustomOrderDraft(sid);
      setDraftListTick((t) => t + 1);
      toast.success('Draft removed');
    },
    [mode, onDeleteDraft]
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {displaySavedTimeLabel ? (
          <span className="text-[11px] text-gray-500 tabular-nums hidden sm:inline">
            Saved · {displaySavedTimeLabel}
          </span>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8"
          icon={Save}
          onClick={handleSaveDraft}
        >
          Save draft
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8"
          icon={ClipboardList}
          onClick={() => setDraftsModalOpen(true)}
        >
          Drafts
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8"
          icon={FilePlus2}
          onClick={handleNewDraft}
        >
          New draft
        </Button>
      </div>

      <Modal
        isOpen={draftsModalOpen}
        onClose={() => setDraftsModalOpen(false)}
        title="Custom order drafts (this device)"
        size="md"
        footer={
          <Button variant="secondary" size="sm" onClick={() => setDraftsModalOpen(false)}>
            Close
          </Button>
        }
      >
        <p className="text-xs text-gray-600 mb-2 leading-snug">
          Drafts are stored in this browser only. Creating an order clears the active draft. Use{' '}
          <span className="font-medium text-gray-800">New draft</span> to save what you have here and
          start another custom order from scratch.
        </p>
        {storedDraftsSorted.length === 0 ? (
          <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-md px-3 py-4 text-center">
            No saved drafts yet.
          </div>
        ) : (
          <div className="max-h-72 overflow-auto divide-y divide-gray-100 border border-gray-200 rounded-md">
            {storedDraftsSorted.map((d) => (
              <div key={d.id} className="flex items-start justify-between gap-2 px-2 py-2 bg-white">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-900 truncate">{d.title || 'Draft'}</div>
                  <div className="text-[11px] text-gray-500 tabular-nums">
                    {formatDraftSavedTime(d.updatedAt) || '—'}
                    {displayActiveDraftId === d.id ? (
                      <span className="ml-1.5 text-brand font-semibold">· Active</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button type="button" size="sm" variant="secondary" onClick={() => handleResumeDraft(d)}>
                    Continue
                  </Button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftToDelete({ id: d.id, title: String(d.title || 'Draft').trim() || 'Draft' })
                    }
                    className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-200 text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete draft"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!draftToDelete}
        onClose={() => setDraftToDelete(null)}
        onConfirm={() => {
          if (draftToDelete?.id) handleDeleteDraft(draftToDelete.id);
          setDraftToDelete(null);
        }}
        title="Delete this draft?"
        message={
          draftToDelete
            ? `Remove "${draftToDelete.title}" from this device? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
      />
    </>
  );
};

CustomOrderDraftActions.propTypes = {
  mode: PropTypes.oneOf(['embedded', 'navigate']).isRequired,
  activeDraftId: PropTypes.string,
  draftSavedTimeLabel: PropTypes.string,
  onSaveDraft: PropTypes.func,
  onNewDraft: PropTypes.func,
  onResumeDraft: PropTypes.func,
  onDeleteDraft: PropTypes.func,
};

CustomOrderDraftActions.defaultProps = {
  activeDraftId: null,
  draftSavedTimeLabel: '',
  onSaveDraft: undefined,
  onNewDraft: undefined,
  onResumeDraft: undefined,
  onDeleteDraft: undefined,
};

export default CustomOrderDraftActions;
