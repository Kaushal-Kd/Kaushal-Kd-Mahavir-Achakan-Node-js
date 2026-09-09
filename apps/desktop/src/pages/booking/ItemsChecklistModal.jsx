import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PropTypes from 'prop-types';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import ChecklistCombinedChargeModal from '../../components/booking/ChecklistCombinedChargeModal.jsx';
import OrderChecklistPanel, {
  CHECKLIST_STAGES,
} from '../../components/booking/OrderChecklistPanel.jsx';
import AdminPasswordModal from '../../components/ui/AdminPasswordModal.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useWhatsAppOutbound } from '../../contexts/WhatsAppOutboundContext.jsx';
import { useModalSize } from '../../hooks/useModalSize.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { useChecklistCommand } from '../../hooks/api/useChecklistCommand.js';
import { ordersApi } from '../../lib/api/orders.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import {
  applyBulkStageTrueToDraft,
  applyConditionPatchWithStageEffects,
  countReceivedBulkSkipped,
  diffStageUpdates,
  stageUpdatesIncludeNewDelivered,
  stageUpdatesIncludeNewReceived,
  stageUpdatesRequireAdminPassword,
  validateStageDraft,
} from '../../lib/orderChecklistMerge.js';
import { runStageTemplateWhatsApp } from '../../lib/whatsappOutbound.js';
import {
  buildReturnConditionUpdates,
  conditionDraftIsDirty,
  needsConditionConfirmOnSave,
} from '../../lib/orderConditionDraft.js';
import { MIXED_DELIVERY_CONDITION_MESSAGE, prepareChecklistCombinedReview, saveChecklistDraft, shouldSendChecklistWhatsApp, useChecklistDraftState } from '../../lib/orderChecklistSave.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';
import { buildWhatsAppTransactionPdf } from '../../utils/whatsappTransactionPdf.js';
import { newMissingLineKeys } from '../../utils/whatsappTransactionRows.js';

const ItemsChecklistModal = ({ isOpen, orderId, onClose, onRequireSettlement }) => {
  const modalSize = useModalSize('3xl');
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const [pendingConditionRows] = useState(() => new Set());
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [combinedChargeOpen, setCombinedChargeOpen] = useState(false);
  const [combinedModalRemarks, setCombinedModalRemarks] = useState('');
  const [combinedModalAccountId, setCombinedModalAccountId] = useState('');
  const [combinedModalPreview, setCombinedModalPreview] = useState({ lines: [], total: 0 });
  const [adminPasswordOpen, setAdminPasswordOpen] = useState(false);
  const [adminPasswordError, setAdminPasswordError] = useState('');
  const wa = useWhatsAppOutbound();
  const pendingWaStageDraftRef = useRef(null);
  const pendingWaOrderRef = useRef(null);
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
    useChecklistDraftState(order, checklist.pendingEntry, { enabled: isOpen, scopeKey: orderId, refetch: orderQuery.refetch });
  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
    enabled: Boolean(isOpen),
  });
  const paymentAccountOptions = paymentAccountsQuery.data?.data || [];
  const isCancelled = order?.status === 'cancelled';
  const allRows = useMemo(
    () => [...(order?.items || []), ...(order?.accessories || [])],
    [order?.items, order?.accessories]
  );
  useEffect(() => {
    if (!isOpen) return;
    setCombinedChargeOpen(false);
    setCombinedModalRemarks('');
    setCombinedModalAccountId('');
    setCombinedModalPreview({ lines: [], total: 0 });
    setAdminPasswordOpen(false);
    setAdminPasswordError('');
    pendingStageUpdatesRef.current = null;
  }, [orderId, isOpen]);

  useEffect(() => {
    if (!isOpen) setDiscardConfirmOpen(false);
  }, [isOpen]);

  const isStageDirty = useMemo(() => {
    if (!order || !stageDraft) return false;
    return diffStageUpdates(draftOrder, stageDraft, conditionDraft).length > 0;
  }, [order, draftOrder, stageDraft, conditionDraft]);

  const isConditionDirty = useMemo(() => {
    if (!order || !conditionDraft) return false;
    return conditionDraftIsDirty(draftOrder, conditionDraft);
  }, [order, draftOrder, conditionDraft]);

  const isAnythingDirty = isStageDirty || isConditionDirty;

  const saveStageMut = useMutation({
    mutationFn: ({ updates, combinedCharge, admin_password }) => saveChecklistDraft({
      submit: checklist.submit, order: draftOrder, stageDraft, conditionDraft,
      stageUpdates: updates, combinedCharge, adminPassword: admin_password,
    }),
    onSuccess: async (result) => {
      setAdminPasswordOpen(false);
      setAdminPasswordError('');
      pendingStageUpdatesRef.current = null;
      setCombinedChargeOpen(false);
      if (result.queued) {
        toast.info('Checklist saved on this device; awaiting sync. Resolve any failed action in Pending sync items.');
        return;
      }
      if (result.order) {
        queryClient.setQueryData(['order', orderId], result.order);
        resetDrafts(result.order);
      }
      await invalidateOrderDomain(queryClient, { orderId });
      toast.success('Checklist stages saved');
      const stageDraftAfter = pendingWaStageDraftRef.current;
      const orderSnapshot = pendingWaOrderRef.current;
      pendingWaStageDraftRef.current = null;
      pendingWaOrderRef.current = null;
      if (shouldSendChecklistWhatsApp(result)) await runStageTemplateWhatsApp(wa, {
        order: orderSnapshot,
        stageDraftAfter,
        orderId,
        actionLabel: 'Checklist stages saved',
        excludeDelivered: true,
      });
      const missingLineKeys = shouldSendChecklistWhatsApp(result) ? newMissingLineKeys(orderSnapshot, result.order) : [];
      if (missingLineKeys.length) await wa.runOutbound({
        templateKey: 'RETURN_MISSING_ITEMS', orderId, order: result.order,
        actionLabel: 'Missing items saved', forcePrompt: true,
        document: buildWhatsAppTransactionPdf(result.order, 'missing', { lineKeys: missingLineKeys }),
      });
      onClose();
    },
    onError: (e) => {
      if (pendingStageUpdatesRef.current) {
        setAdminPasswordError(getApiErrorMessage(e, 'Could not verify password'));
        return;
      }
      pendingWaStageDraftRef.current = null;
      pendingWaOrderRef.current = null;
      toast.error(
        e?.response?.data?.error?.message || e?.message || 'Failed to save checklist stages'
      );
    },
  });

  const openCombinedChargeModal = () => {
    const preview = prepareChecklistCombinedReview(draftOrder, conditionDraft);
    setCombinedModalPreview({ lines: preview.lines, total: preview.total });
    setCombinedModalRemarks(preview.remarks);
    const suggested = String(order?.deposit_context?.primary_payment_account_id || '').trim();
    setCombinedModalAccountId(suggested);
    setCombinedChargeOpen(true);
  };

  const finishSaveAfterConditions = async (combinedCharge = null) => {
    if (locked) return;
    const workingOrder = draftOrder;
    const updates = diffStageUpdates(workingOrder, stageDraft, conditionDraft);

    if (updates.length === 0 && !isConditionDirty) {
      toast.info('No changes to save');
      return;
    }

    if (stageUpdatesIncludeNewDelivered(updates)) {
      if (isConditionDirty) { toast.warning(MIXED_DELIVERY_CONDITION_MESSAGE); return; }
      onRequireSettlement(workingOrder.id, {
        settlementKind: 'delivery',
        stageUpdates: updates,
        stageDraftAfter: stageDraft,
      });
      return;
    }
    if (stageUpdatesIncludeNewReceived(updates)) {
      onRequireSettlement(workingOrder.id, {
        settlementKind: 'return',
        stageUpdates: updates,
        stageDraftAfter: stageDraft,
      });
      return;
    }
    const v = validateStageDraft(workingOrder, stageDraft, { skipReturnDepositGate: true });
    if (!v.ok) {
      toast.error(v.message);
      if (v.requireSettlement) {
        onRequireSettlement(workingOrder.id, {
          settlementKind: v.settlementKind,
          stageUpdates: updates,
          stageDraftAfter: stageDraft,
        });
      }
      return;
    }
    pendingWaStageDraftRef.current = stageDraft;
    pendingWaOrderRef.current = workingOrder;
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
    pendingWaStageDraftRef.current = null;
    pendingWaOrderRef.current = null;
  };

  const handleSaveStages = async () => {
    if (!draftOrder || !stageDraft || locked) return;
    const hasConditionChanges = isConditionDirty;

    const draftStageUpdates = diffStageUpdates(draftOrder, stageDraft, conditionDraft);
    if (stageUpdatesIncludeNewDelivered(draftStageUpdates) && hasConditionChanges) {
      toast.warning(MIXED_DELIVERY_CONDITION_MESSAGE); return;
    }
    if (stageUpdatesIncludeNewReceived(draftStageUpdates)) {
      onRequireSettlement(order.id, {
        settlementKind: 'return',
        stageUpdates: draftStageUpdates,
        stageDraftAfter: stageDraft,
        conditionUpdates: buildReturnConditionUpdates(draftOrder, conditionDraft, draftStageUpdates),
      });
      return;
    }

    if (hasConditionChanges && (draftOrder.pending_checklist_combined_charge || needsConditionConfirmOnSave(draftOrder, conditionDraft))) {
      openCombinedChargeModal();
      return;
    }

    await finishSaveAfterConditions();
  };

  const handleCombinedChargeConfirm = async () => {
    if (combinedModalPreview.total > 0 && !combinedModalAccountId.trim()) {
      toast.error('Select account for combined charge');
      return;
    }
    await finishSaveAfterConditions({
        amount: combinedModalPreview.total,
        accountId: combinedModalAccountId,
        remarks: combinedModalRemarks,
    });
  };

  const handleResetStages = () => {
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

  const handleConditionDraftChange = (itemType, id, patch) => {
    if (locked) return;
    const { conditionDraft: nextCondition, stageDraft: nextStage } =
      applyConditionPatchWithStageEffects(draftOrder, stageDraft, conditionDraft, itemType, id, patch);
    setConditionDraft(nextCondition);
    setStageDraft(nextStage);
  };

  const bulkCheck = (field) => {
    if (!draftOrder || !stageDraft || locked) return;
    if (isCancelled) return;
    const skippedReceived =
      field === 'received' ? countReceivedBulkSkipped(draftOrder, stageDraft, conditionDraft) : 0;
    const next = applyBulkStageTrueToDraft(stageDraft, field, draftOrder, conditionDraft);
    const v = validateStageDraft(draftOrder, next, {
      skipReturnDepositGate: field === 'received',
    });
    if (!v.ok) {
      toast.error(v.message);
      return;
    }
    setStageDraft(next);
    if (skippedReceived > 0) {
      toast.info(`Received not applied to ${skippedReceived} line(s) — line is Missing.`);
    }
  };

  return (
    <Fragment>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        size={modalSize}
        title={order ? `Items checklist · ${order.order_number}` : 'Items checklist'}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={handleResetStages}
              disabled={!order || isCancelled || !isAnythingDirty || locked}
            >
              Reset changes
            </Button>
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
            <Button
              onClick={handleSaveStages}
              loading={saveStageMut.isPending}
              disabled={!order || isCancelled || !isAnythingDirty || locked}
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
        ) : (
          <div className="space-y-3">
            {locked ? <div role="status" className="space-y-2 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              <p>{refreshError || (checklist.pendingEntry ? 'This checklist has a pending sync action. The saved draft is shown below and cannot be edited until it is confirmed or removed in Pending sync items.' : 'Refreshing the confirmed checklist before further edits.')} {checklist.pendingEntry?.error || checklist.pendingEntry?.blockedReason || ''}</p>
              {checklist.pendingEntry?.payload?.combined_assessment ? <p>Pending assessment: {Number(checklist.pendingEntry.payload.combined_assessment.amount).toFixed(2)}. {checklist.pendingEntry.payload.combined_assessment.remarks}</p> : null}
              {refreshError ? <Button size="sm" variant="secondary" onClick={() => void refreshDrafts()}>Refresh checklist</Button> : null}
            </div> : !checklist.isOnline ? <p className="text-sm text-yellow-800">Offline changes will be saved on this device and validated during sync.</p> : null}
            {order.customer_notes ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                  Customer notes
                </div>
                <div className="text-sm font-medium text-brand whitespace-pre-wrap">
                  {order.customer_notes}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500">Quick check all:</span>
                {CHECKLIST_STAGES.map((s) => (
                  <Button
                    key={s.key}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => bulkCheck(s.key)}
                    disabled={
                      saveStageMut.isPending || locked || isCancelled || allRows.length === 0 || !stageDraft
                    }
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500">
                Item to collect / Prepared apply only when Current status is{' '}
                <span className="font-medium text-gray-700">Available</span> (same as Item to
                Collect / Prepare pages).
              </p>
            </div>

            <OrderChecklistPanel
              order={draftOrder}
              stageDraft={stageDraft}
              setStageDraft={setStageDraft}
              paymentAccountOptions={paymentAccountOptions}
              pendingConditionRows={pendingConditionRows}
              disabled={saveStageMut.isPending || locked || isCancelled}
              onStageIntentFailed={() => {}}
              conditionDraft={conditionDraft}
              onConditionDraftChange={handleConditionDraftChange}
              nextBookingReturnTo="/booking"
              nextBookingReturnLabel="Bookings"
              onNextBookingNavigate={onClose}
            />
          </div>
        )}
      </Modal>
      <ChecklistCombinedChargeModal
        isOpen={combinedChargeOpen}
        onClose={() => !saveStageMut.isPending && setCombinedChargeOpen(false)}
        onConfirm={handleCombinedChargeConfirm}
        lines={combinedModalPreview.lines}
        total={combinedModalPreview.total}
        remarks={combinedModalRemarks}
        onRemarksChange={setCombinedModalRemarks}
        accountId={combinedModalAccountId}
        onAccountIdChange={setCombinedModalAccountId}
        paymentAccountOptions={paymentAccountOptions}
        loading={saveStageMut.isPending}
      />
      <ConfirmDialog
        isOpen={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        onConfirm={confirmDiscardAndClose}
        title="Discard unsaved changes?"
        message="You have unsaved checklist changes (stages or missing/damage). Close without saving them?"
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

ItemsChecklistModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  orderId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onRequireSettlement: PropTypes.func,
};

ItemsChecklistModal.defaultProps = {
  orderId: null,
  onRequireSettlement: () => {},
};

export default ItemsChecklistModal;
