import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PropTypes from 'prop-types';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import OrderChecklistPanel from '../../components/booking/OrderChecklistPanel.jsx';
import ChecklistCombinedChargeModal from '../booking/ChecklistCombinedChargeModal.jsx';
import AdminPasswordModal from '../ui/AdminPasswordModal.jsx';
import Button from '../ui/Button.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import Modal from '../ui/Modal.jsx';
import { useModalSize } from '../../hooks/useModalSize.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { useChecklistCommand } from '../../hooks/api/useChecklistCommand.js';
import { ordersApi } from '../../lib/api/orders.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import {
  applyConditionPatchWithStageEffects,
  diffStageUpdates,
  stageUpdatesIncludeNewDelivered,
  stageUpdatesIncludeNewReceived,
  stageUpdatesRequireAdminPassword,
  validateStageDraft,
} from '../../lib/orderChecklistMerge.js';
import { conditionDraftIsDirty, needsConditionConfirmOnSave } from '../../lib/orderConditionDraft.js';
import { prepareChecklistCombinedReview, saveChecklistDraft, useChecklistDraftState } from '../../lib/orderChecklistSave.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';

/**
 * @param {object} order
 * @param {string} orderItemId
 */
function buildFocusedOrder(order, orderItemId) {
  if (!order) return null;
  const item = (order.items || []).find((i) => String(i.id) === String(orderItemId));
  if (!item) return null;
  const accessories = (order.accessories || []).filter(
    (a) => String(a.order_item_id) === String(orderItemId)
  );
  return { ...order, items: [item], accessories };
}

const CONTEXT_HINT = {
  collect:
    'Mark Prepared on accessories. Use Collect on the product when the line is ready to leave this list.',
  prepare: 'Mark Prepared on the product and its accessories when ready.',
};

const ItemLineAccessoriesChecklistModal = ({
  isOpen,
  orderId,
  orderItemId,
  context,
  productLabel,
  onClose,
  listQueryKey,
}) => {
  const modalSize = useModalSize('2xl');
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const [combinedChargeOpen, setCombinedChargeOpen] = useState(false);
  const [combinedRemarks, setCombinedRemarks] = useState('');
  const [combinedAccountId, setCombinedAccountId] = useState('');
  const [combinedPreview, setCombinedPreview] = useState({ lines: [], total: 0 });
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [adminPasswordOpen, setAdminPasswordOpen] = useState(false);
  const [adminPasswordError, setAdminPasswordError] = useState('');
  const pendingStageUpdatesRef = useRef(null);

  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => ordersApi.get(orderId).then((r) => r.data),
    enabled: Boolean(isOpen && orderId),
    staleTime: 30_000,
  });

  const order = orderQuery.data;
  const checklist = useChecklistCommand(orderId);
  const { draftOrder, stageDraft, setStageDraft, conditionDraft, setConditionDraft, resetDrafts, refreshDrafts, refreshError, locked } =
    useChecklistDraftState(order, checklist.pendingEntry, { enabled: isOpen, scopeKey: `${orderId}:${orderItemId}`, refetch: orderQuery.refetch });
  const paymentAccountsQuery = useQuery({ queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(), enabled: isOpen });
  const paymentAccountOptions = paymentAccountsQuery.data?.data || [];
  const focusedOrder = useMemo(
    () => (draftOrder && orderItemId ? buildFocusedOrder(draftOrder, orderItemId) : null),
    [draftOrder, orderItemId]
  );
  const isCancelled = order?.status === 'cancelled';

  useEffect(() => {
    if (!isOpen) return;
    setCombinedChargeOpen(false);
    setAdminPasswordOpen(false);
    setAdminPasswordError('');
    pendingStageUpdatesRef.current = null;
  }, [orderId, orderItemId, isOpen]);

  useEffect(() => {
    if (!isOpen) setDiscardConfirmOpen(false);
  }, [isOpen]);

  const handleConditionDraftChange = (itemType, id, patch) => {
    if (locked) return;
    const { conditionDraft: nextCondition, stageDraft: nextStage } = applyConditionPatchWithStageEffects(
      draftOrder,
      stageDraft,
      conditionDraft,
      itemType,
      id,
      patch
    );
    setConditionDraft(nextCondition);
    setStageDraft(nextStage);
  };

  const isStageDirty = useMemo(() => {
    if (!focusedOrder || !stageDraft) return false;
    return diffStageUpdates(draftOrder, stageDraft, conditionDraft).length > 0;
  }, [focusedOrder, draftOrder, stageDraft, conditionDraft]);
  const isConditionDirty = Boolean(draftOrder && conditionDraft && conditionDraftIsDirty(draftOrder, conditionDraft));
  const isAnythingDirty = isStageDirty || isConditionDirty;

  const saveStageMut = useMutation({
    mutationFn: ({ updates, combinedCharge, admin_password }) => saveChecklistDraft({ submit: checklist.submit,
      order: draftOrder, stageDraft, conditionDraft, stageUpdates: updates, combinedCharge, adminPassword: admin_password }),
    onSuccess: async (result) => {
      setAdminPasswordOpen(false);
      setAdminPasswordError('');
      pendingStageUpdatesRef.current = null;
      setCombinedChargeOpen(false);
      if (result.queued) { toast.info('Accessory checklist is saved on this device and awaiting sync.'); return; }
      if (result.order) { queryClient.setQueryData(['order', orderId], result.order); resetDrafts(result.order); }
      await invalidateOrderDomain(queryClient, { orderId });
      if (listQueryKey) {
        await queryClient.invalidateQueries({ queryKey: [listQueryKey] });
      }
      toast.success('Accessory checklist saved');
      onClose();
    },
    onError: (e) => {
      if (pendingStageUpdatesRef.current) {
        setAdminPasswordError(getApiErrorMessage(e, 'Could not verify password'));
        return;
      }
      toast.error(e?.response?.data?.error?.message || e?.message || 'Failed to save checklist');
    },
  });

  const handleSave = (combinedCharge = null) => {
    if (!focusedOrder || !stageDraft || locked) return;
    const updates = diffStageUpdates(draftOrder, stageDraft, conditionDraft);
    if (updates.length === 0 && !isConditionDirty) {
      toast.info('No changes to save');
      return;
    }
    if (stageUpdatesIncludeNewDelivered(updates) || stageUpdatesIncludeNewReceived(updates)) {
      toast.warning('Use this booking’s Delivery or Return settlement to save these changes. Nothing has been saved.'); return;
    }
    const v = validateStageDraft(draftOrder, stageDraft, { skipReturnDepositGate: true });
    if (!v.ok) {
      toast.error(v.message);
      return;
    }
    if (!combinedCharge && isConditionDirty && (draftOrder.pending_checklist_combined_charge || needsConditionConfirmOnSave(draftOrder, conditionDraft))) {
      const preview = prepareChecklistCombinedReview(draftOrder, conditionDraft);
      setCombinedPreview(preview); setCombinedRemarks(preview.remarks); setCombinedAccountId(''); setCombinedChargeOpen(true); return;
    }
    if (stageUpdatesRequireAdminPassword(updates)) {
      pendingStageUpdatesRef.current = { updates, combinedCharge };
      setAdminPasswordError('');
      setAdminPasswordOpen(true);
      return;
    }
    saveStageMut.mutate({ updates, combinedCharge });
  };

  const handleAdminPasswordConfirm = (adminPassword) => {
    const command = pendingStageUpdatesRef.current;
    if (!command || locked) return;
    setAdminPasswordError('');
    saveStageMut.mutate({ ...command, admin_password: adminPassword });
  };

  const handleAdminPasswordClose = () => {
    if (saveStageMut.isPending) return;
    setAdminPasswordOpen(false);
    setAdminPasswordError('');
    pendingStageUpdatesRef.current = null;
  };

  const handleReset = () => {
    if (!order || locked) return;
    resetDrafts(order);
  };

  const handleClose = () => {
    if (saveStageMut.isPending) return;
    if (isAnythingDirty && !locked) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  const confirmDiscardAndClose = () => {
    setDiscardConfirmOpen(false);
    onClose();
  };

  const title = productLabel
    ? `Accessories · ${productLabel}`
    : 'Accessories checklist';

  return (
    <Fragment>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        size={modalSize}
        title={title}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={handleReset}
              disabled={!focusedOrder || isCancelled || !isAnythingDirty || locked}
            >
              Reset changes
            </Button>
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
            <Button
              onClick={() => handleSave()}
              loading={saveStageMut.isPending}
              disabled={!focusedOrder || isCancelled || !isAnythingDirty || locked}
            >
              Save changes
            </Button>
          </>
        }
      >
        {orderQuery.isLoading ? (
          <p className="text-sm text-gray-500">Loading checklist…</p>
        ) : orderQuery.isError || !order ? (
          <p className="text-sm text-red-600">Could not load checklist.</p>
        ) : !focusedOrder ? (
          <p className="text-sm text-red-600">Product line not found on this booking.</p>
        ) : (
          <div className="space-y-3">
            {locked ? <div role="status" className="space-y-2 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              <p>{refreshError || (checklist.pendingEntry ? 'A saved checklist action is awaiting sync. The pending draft is shown; resolve it in Pending sync items before editing again.' : 'Refreshing the confirmed checklist before further edits.')} {checklist.pendingEntry?.error || checklist.pendingEntry?.blockedReason || ''}</p>
              {checklist.pendingEntry?.payload?.combined_assessment ? <p>Pending assessment: {Number(checklist.pendingEntry.payload.combined_assessment.amount).toFixed(2)}. {checklist.pendingEntry.payload.combined_assessment.remarks}</p> : null}
              {refreshError ? <Button size="sm" variant="secondary" onClick={() => void refreshDrafts()}>Refresh checklist</Button> : null}
            </div> : !checklist.isOnline ? <p className="text-sm text-yellow-800">Offline changes will be saved on this device and validated during sync.</p> : null}
            <p className="text-xs text-gray-600">{CONTEXT_HINT[context] || CONTEXT_HINT.prepare}</p>
            <OrderChecklistPanel
              order={focusedOrder}
              stageDraft={stageDraft}
              setStageDraft={setStageDraft}
              paymentAccountOptions={paymentAccountOptions}
              pendingConditionRows={new Set()}
              disabled={saveStageMut.isPending || locked || isCancelled}
              onStageIntentFailed={() => {}}
              conditionDraft={conditionDraft}
              onConditionDraftChange={handleConditionDraftChange}
              dense
            />
          </div>
        )}
      </Modal>
      <ChecklistCombinedChargeModal isOpen={combinedChargeOpen} onClose={() => !saveStageMut.isPending && setCombinedChargeOpen(false)}
        onConfirm={() => handleSave({ amount: combinedPreview.total, remarks: combinedRemarks, accountId: combinedAccountId })}
        lines={combinedPreview.lines} total={combinedPreview.total} remarks={combinedRemarks} onRemarksChange={setCombinedRemarks}
        accountId={combinedAccountId} onAccountIdChange={setCombinedAccountId} paymentAccountOptions={paymentAccountOptions} loading={saveStageMut.isPending} />
      <ConfirmDialog
        isOpen={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        onConfirm={confirmDiscardAndClose}
        title="Discard unsaved changes?"
        message="Close without saving checklist changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
      />
      <AdminPasswordModal
        isOpen={adminPasswordOpen}
        title="Undo delivered / received"
        description="Unchecking Delivered or Received on items that were already marked requires Shop Admin approval."
        orderLabel={order?.order_number || ''}
        shopName={selectedShopName}
        errorMessage={adminPasswordError}
        loading={saveStageMut.isPending}
        confirmLabel="Save changes"
        onClearError={() => setAdminPasswordError('')}
        onClose={handleAdminPasswordClose}
        onConfirm={handleAdminPasswordConfirm}
      />
    </Fragment>
  );
};

ItemLineAccessoriesChecklistModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  orderId: PropTypes.string,
  orderItemId: PropTypes.string,
  context: PropTypes.oneOf(['collect', 'prepare']).isRequired,
  productLabel: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  listQueryKey: PropTypes.string,
};

ItemLineAccessoriesChecklistModal.defaultProps = {
  orderId: null,
  orderItemId: null,
  productLabel: '',
  listQueryKey: null,
};

export default ItemLineAccessoriesChecklistModal;
