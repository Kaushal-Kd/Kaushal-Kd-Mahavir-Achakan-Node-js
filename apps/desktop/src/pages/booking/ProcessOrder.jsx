import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatBookingDateTime,
  formatCurrency,
  formatDate,
  ORDER_STATUS_LABELS,
} from '@wrs/shared';
import { Printer, XCircle, ArrowLeft, MessageCircle } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';

import ChecklistCombinedChargeModal from '../../components/booking/ChecklistCombinedChargeModal.jsx';
import OrderChecklistPanel, {
  CHECKLIST_STAGES,
} from '../../components/booking/OrderChecklistPanel.jsx';
import PrintTokenTypeModal from '../../components/booking/PrintTokenTypeModal.jsx';
import AdminPasswordModal from '../../components/ui/AdminPasswordModal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { useWhatsAppOutbound } from '../../contexts/WhatsAppOutboundContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { useChecklistCommand } from '../../hooks/api/useChecklistCommand.js';
import { bookingCustomerContactSummary } from '../../lib/bookingCustomerHydration.js';
import { customersApi } from '../../lib/api/customers.js';
import { ordersApi } from '../../lib/api/orders.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import {
  applyBulkStageTrueToDraft,
  applyConditionPatchWithStageEffects,
  countReceivedBulkSkipped,
  diffStageUpdates,
  isOrderFullyAtStage,
  stageUpdatesIncludeNewDelivered,
  stageUpdatesIncludeNewReceived,
  stageUpdatesRequireAdminPassword,
  validateStageDraft,
} from '../../lib/orderChecklistMerge.js';
import {
  buildReturnConditionUpdates,
  conditionDraftIsDirty,
  needsConditionConfirmOnSave,
} from '../../lib/orderConditionDraft.js';
import { MIXED_DELIVERY_CONDITION_MESSAGE, prepareChecklistCombinedReview, saveChecklistDraft, shouldSendChecklistWhatsApp, useChecklistDraftState } from '../../lib/orderChecklistSave.js';
import { runReturnMissingWhatsAppFlow } from '../../lib/returnMissingWhatsAppFlow.js';
import {
  getBookingTokenAvailability,
  printBookingAccessoryTokens,
  printBookingProductTokens,
} from '../../lib/bookingTokenPrint.js';
import {
  clearTokenDownloadPrompt,
  readTokenDownloadPrompt,
} from '../../lib/bookingTokenDownloadPrompt.js';
import { STAGES_WITH_CANCEL, stageFromOrderStatus } from '../../lib/orderListStage.js';
import { runStageTemplateWhatsApp } from '../../lib/whatsappOutbound.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';
import { printBill } from '../../utils/printBill.js';
import { buildWhatsAppTransactionPdf } from '../../utils/whatsappTransactionPdf.js';
import ReplacementRequirementsPanel from './ReplacementRequirementsPanel.jsx';

import PaymentsPanel from './PaymentsPanel.jsx';
import DeliverySettlementModal from './DeliverySettlementModal.jsx';
import ReturnSettlementModal from './ReturnSettlementModal.jsx';
import SettlementModal from './SettlementModal.jsx';
import CancelSummaryModal from './CancelSummaryModal.jsx';

const ORDER_STATUS_BADGE_TONE = {
  booked: 'yellow',
  pending: 'yellow',
  confirmed: 'brand',
  item_to_collect: 'brand',
  in_preparation: 'brand',
  ready_for_delivery: 'brand',
  delivered: 'green',
  partially_returned: 'yellow',
  returned: 'gray',
  closed: 'gray',
  cancelled: 'red',
  draft: 'gray',
};

function yesNo(value) {
  return value === true || value === 1 || value === '1' ? 'Yes' : 'No';
}

function ledgerName(id, map) {
  if (!id) return '—';
  return map.get(id) || id;
}

const ProcessOrder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.returnTo;
  const returnLabel = location.state?.returnLabel || 'Back';
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const [combinedChargeOpen, setCombinedChargeOpen] = useState(false);
  const [combinedModalRemarks, setCombinedModalRemarks] = useState('');
  const [combinedModalAccountId, setCombinedModalAccountId] = useState('');
  const [combinedModalPreview, setCombinedModalPreview] = useState({ lines: [], total: 0 });
  const [adminPasswordOpen, setAdminPasswordOpen] = useState(false);
  const [adminPasswordError, setAdminPasswordError] = useState('');
  const [pendingConditionRows] = useState(() => new Set());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [deliverySettlementOpen, setDeliverySettlementOpen] = useState(false);
  const [deliveryStageUpdates, setDeliveryStageUpdates] = useState(null);
  const [deliveryStageDraftAfter, setDeliveryStageDraftAfter] = useState(null);
  const [returnSettlementOpen, setReturnSettlementOpen] = useState(false);
  const [returnStageUpdates, setReturnStageUpdates] = useState(null);
  const [returnStageDraftAfter, setReturnStageDraftAfter] = useState(null);
  const [returnConditionUpdates, setReturnConditionUpdates] = useState(null);
  const [summaryHighlight, setSummaryHighlight] = useState(false);
  const wa = useWhatsAppOutbound();
  const pendingWaStageDraftRef = useRef(null);
  const pendingWaOrderRef = useRef(null);
  const pendingStageUpdatesRef = useRef(null);
  const tokenPromptOpenedRef = useRef(false);
  const [tokenDownloadOrder, setTokenDownloadOrder] = useState(() => readTokenDownloadPrompt(id));
  const [tokenDownloadLoading, setTokenDownloadLoading] = useState(false);

  useEffect(() => {
    const shouldPrompt =
      location.state?.promptTokenDownload === true || Boolean(readTokenDownloadPrompt(id));
    if (!shouldPrompt || tokenPromptOpenedRef.current) return;

    const savedOrder = readTokenDownloadPrompt(id) || location.state?.savedOrder || null;
    if (savedOrder) {
      tokenPromptOpenedRef.current = true;
      setTokenDownloadOrder(savedOrder);
    } else if (id && location.state?.promptTokenDownload) {
      tokenPromptOpenedRef.current = true;
      ordersApi
        .get(id)
        .then((resp) => {
          const order = resp?.data || null;
          if (order) setTokenDownloadOrder(order);
        })
        .catch(() => {
          /* modal stays closed if fetch fails */
        });
    }

    if (location.state?.promptTokenDownload) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [id, location.pathname, location.state, navigate]);

  const closeTokenDownloadModal = () => {
    if (!tokenDownloadLoading) {
      setTokenDownloadOrder(null);
      clearTokenDownloadPrompt();
    }
  };

  const resolveTokenDownloadOrder = async () => {
    const orderId = tokenDownloadOrder?.id || id;
    if (!orderId) return null;
    if (data?.id && String(data.id) === String(orderId)) return data;
    try {
      const resp = await ordersApi.get(orderId);
      return resp?.data || tokenDownloadOrder;
    } catch {
      return tokenDownloadOrder;
    }
  };

  const runTokenPrint = async (kind) => {
    if (!tokenDownloadOrder) return;
    setTokenDownloadLoading(true);
    try {
      const order = await resolveTokenDownloadOrder();
      if (!order) return;
      if (kind === 'product') await printBookingProductTokens(order);
      else await printBookingAccessoryTokens(order);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not print tokens');
    } finally {
      setTokenDownloadLoading(false);
    }
  };

  const runBillPrint = async () => {
    if (!tokenDownloadOrder) return;
    setTokenDownloadLoading(true);
    try {
      const order = await resolveTokenDownloadOrder();
      if (!order) return;
      await printBill(order);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not print bill');
    } finally {
      setTokenDownloadLoading(false);
    }
  };

  const {
    data,
    error: orderLoadError,
    isError: isOrderLoadError,
    isFetching: isOrderFetching,
    isLoading,
    refetch: refetchOrder,
  } = useQuery({
    queryKey: ['order', id],
    queryFn: () => ordersApi.get(id).then((r) => r.data),
    staleTime: 30_000,
  });

  const tokenOrderForSlips = useMemo(() => {
    if (!tokenDownloadOrder) return null;
    if (data?.id && String(data.id) === String(tokenDownloadOrder.id)) return data;
    return tokenDownloadOrder;
  }, [tokenDownloadOrder, data]);

  const tokenAvailability = useMemo(
    () =>
      tokenOrderForSlips
        ? getBookingTokenAvailability(tokenOrderForSlips)
        : { hasProduct: false, hasAccessory: false },
    [tokenOrderForSlips]
  );

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });
  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'order-details'],
    queryFn: () => securityAccountsApi.list(),
  });

  const customerDetailsQuery = useQuery({
    queryKey: ['customer', data?.customer_id, 'order-details'],
    queryFn: () => customersApi.get(data.customer_id),
    enabled: !!data?.customer_id && !data?.customer,
  });

  const checklist = useChecklistCommand(id);
  const { draftOrder, stageDraft, setStageDraft, conditionDraft, setConditionDraft, resetDrafts, refreshDrafts, refreshError, locked } =
    useChecklistDraftState(data, checklist.pendingEntry, { scopeKey: id, refetch: refetchOrder });
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
      if (result.order) { queryClient.setQueryData(['order', id], result.order); resetDrafts(result.order); }
      await invalidateOrderDomain(queryClient, { orderId: id });
      toast.success('Checklist stages saved');
      const stageDraftAfter = pendingWaStageDraftRef.current;
      const orderSnapshot = pendingWaOrderRef.current;
      pendingWaStageDraftRef.current = null;
      pendingWaOrderRef.current = null;
      const customerForWa = orderSnapshot?.customer || customerDetailsQuery.data?.data || null;
      if (shouldSendChecklistWhatsApp(result)) await runStageTemplateWhatsApp(wa, {
        order: orderSnapshot,
        stageDraftAfter,
        orderId: id,
        customer: customerForWa,
        actionLabel: 'Checklist stages saved',
        excludeDelivered: true,
      });
      if (shouldSendChecklistWhatsApp(result)) await runReturnMissingWhatsAppFlow({ wa, orderBefore: orderSnapshot, orderAfter: result.order, orderId: id });
    },
    onError: (e) => {
      if (pendingStageUpdatesRef.current) {
        setAdminPasswordError(getApiErrorMessage(e, 'Could not verify password'));
        return;
      }
      pendingWaStageDraftRef.current = null;
      pendingWaOrderRef.current = null;
      toast.error(e.response?.data?.error?.message || e?.message || 'Failed to save stages');
    },
  });

  const cancelMut = useMutation({
    mutationFn: () => ordersApi.cancel(id),
    onSuccess: async () => {
      toast.success('Order cancelled');
      setCancelOpen(false);
      await invalidateOrderDomain(queryClient, { orderId: id });
    },
    onError: (e) => toast.error(e.response?.data?.error?.message || 'Failed to cancel'),
  });

  useEffect(() => {
    setCombinedChargeOpen(false);
    setCombinedModalRemarks('');
    setCombinedModalAccountId('');
    setCombinedModalPreview({ lines: [], total: 0 });
  }, [id]);

  useEffect(() => {
    if (!data?.id) return;
    setSummaryHighlight(true);
    const t = window.setTimeout(() => setSummaryHighlight(false), 3000);
    return () => window.clearTimeout(t);
  }, [data?.id]);

  const isStageDirty = useMemo(() => {
    if (!data || !stageDraft) return false;
    return diffStageUpdates(draftOrder, stageDraft, conditionDraft).length > 0;
  }, [data, draftOrder, stageDraft, conditionDraft]);

  const isConditionDirty = useMemo(() => {
    if (!data || !conditionDraft) return false;
    return conditionDraftIsDirty(draftOrder, conditionDraft);
  }, [data, draftOrder, conditionDraft]);

  const isAnythingDirty = isStageDirty || isConditionDirty;

  const handleConditionDraftChange = (itemType, rowId, patch) => {
    if (locked) return;
    const { conditionDraft: nextCondition, stageDraft: nextStage } =
      applyConditionPatchWithStageEffects(draftOrder, stageDraft, conditionDraft, itemType, rowId, patch);
    setConditionDraft(nextCondition);
    setStageDraft(nextStage);
  };

  const showCancelOrderButton = useMemo(() => {
    if (!data || data.status === 'cancelled') return false;
    if (isOrderFullyAtStage(data, 'received')) return false;
    const stage = stageFromOrderStatus(data.status);
    return STAGES_WITH_CANCEL.has(stage);
  }, [data]);

  const linkedCustomOrders = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data.linked_custom_orders) && data.linked_custom_orders.length) {
      return data.linked_custom_orders;
    }
    if (data.linked_custom_order_id && data.linked_custom_order_number) {
      return [{ id: data.linked_custom_order_id, order_number: data.linked_custom_order_number }];
    }
    return [];
  }, [data]);

  const tokenDownloadModal = (
    <PrintTokenTypeModal
      isOpen={Boolean(tokenDownloadOrder)}
      mode="print"
      requireExplicitClose
      onClose={closeTokenDownloadModal}
      onChooseProduct={() => runTokenPrint('product')}
      onChooseAccessories={() => runTokenPrint('accessory')}
      onChooseBill={runBillPrint}
      loading={tokenDownloadLoading}
      orderLabel={tokenDownloadOrder?.order_number || tokenDownloadOrder?.bill_no || ''}
      showProduct={tokenAvailability.hasProduct}
      showAccessories={tokenAvailability.hasAccessory}
      showBill
    />
  );

  if (isLoading) {
    return (
      <>
        <PageHeader title="Order" description="Loading..." />
        <Skeleton className="h-40" />
        {tokenDownloadModal}
      </>
    );
  }

  if (isOrderLoadError || !data) {
    return (
      <>
        <PageHeader title="Order" description="Could not load this booking" />
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-medium text-red-700">Booking details could not be loaded.</p>
          <p className="mt-1 text-sm text-red-600">
            {getApiErrorMessage(
              orderLoadError,
              'Please check the backend connection and try again.'
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button loading={isOrderFetching} onClick={() => refetchOrder()}>
              Retry
            </Button>
            <Button variant="secondary" onClick={() => navigate(returnTo || '/booking')}>
              {returnTo ? returnLabel : 'Back to bookings'}
            </Button>
          </div>
        </div>
        {tokenDownloadModal}
      </>
    );
  }

  const order = data;
  const customer = data?.customer || customerDetailsQuery.data?.data || null;
  const contactSummary = bookingCustomerContactSummary(customer, order);

  const items = order.items || [];
  const accessories = order.accessories || [];
  const allRows = [...items, ...accessories];

  const openDeliverySettlement = (stageUpdates = null, stageDraftAfter = null) => {
    if (locked) return;
    setDeliveryStageUpdates(stageUpdates);
    setDeliveryStageDraftAfter(stageDraftAfter);
    setDeliverySettlementOpen(true);
  };

  const closeDeliverySettlement = () => {
    setDeliverySettlementOpen(false);
    setDeliveryStageUpdates(null);
    setDeliveryStageDraftAfter(null);
  };

  const openReturnSettlement = (
    stageUpdates = null,
    stageDraftAfter = null,
    conditionUpdates = null
  ) => {
    if (locked) return;
    setReturnStageUpdates(stageUpdates);
    setReturnStageDraftAfter(stageDraftAfter);
    setReturnConditionUpdates(conditionUpdates);
    setReturnSettlementOpen(true);
  };

  const closeReturnSettlement = () => {
    setReturnSettlementOpen(false);
    setReturnStageUpdates(null);
    setReturnStageDraftAfter(null);
    setReturnConditionUpdates(null);
  };

  const bulkCheck = (field) => {
    if (order.status === 'cancelled' || !stageDraft || locked) return;
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
      openDeliverySettlement(updates, stageDraft);
      return;
    }
    if (stageUpdatesIncludeNewReceived(updates)) {
      openReturnSettlement(updates, stageDraft);
      return;
    }
    const v = validateStageDraft(workingOrder, stageDraft, { skipReturnDepositGate: true });
    if (!v.ok) {
      toast.error(v.message);
      if (v.requireSettlement) {
        if (v.settlementKind === 'delivery') openDeliverySettlement(updates, stageDraft);
        else openReturnSettlement(updates, stageDraft);
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
    if (!stageDraft || locked) return;
    const hasConditionChanges = isConditionDirty;

    const draftStageUpdates = diffStageUpdates(draftOrder, stageDraft, conditionDraft);
    if (stageUpdatesIncludeNewDelivered(draftStageUpdates) && hasConditionChanges) {
      toast.warning(MIXED_DELIVERY_CONDITION_MESSAGE); return;
    }
    if (stageUpdatesIncludeNewReceived(draftStageUpdates)) {
      openReturnSettlement(
        draftStageUpdates,
        stageDraft,
        buildReturnConditionUpdates(draftOrder, conditionDraft, draftStageUpdates)
      );
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
    if (!locked) resetDrafts(order);
  };

  const resendTransactionWhatsApp = async (templateKey, kind) => {
    const fresh = await ordersApi.get(order.id).then((response) => response.data);
    await wa.runOutbound({
      templateKey,
      orderId: order.id,
      order: fresh,
      customer: fresh.customer || customer,
      actionLabel: 'Resend',
      forcePrompt: true,
      document: buildWhatsAppTransactionPdf(fresh, kind),
    });
  };

  const hasMissingLines = [...(order.items || []), ...(order.accessories || [])].some(
    (line) => !!line.missing
  );

  return (
    <>
      <PageHeader
        title={`Order ${order.order_number}`}
        description={`Booked on ${formatBookingDateTime(order.booking_date, order.booking_time) || formatDate(order.booking_date)} \u00b7 Pickup ${formatDate(
          order.pickup_date
        )} \u00b7 Return ${formatDate(order.return_date)}`}
        actions={
          <div className="flex gap-2">
            {returnTo ? (
              <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(returnTo)}>
                {returnLabel}
              </Button>
            ) : null}
            <Button variant="secondary" icon={Printer} onClick={() => printBill(order)}>
              Print bill
            </Button>
            {['delivered', 'partially_returned', 'returned', 'closed'].includes(order.status) ? (
              <Button
                variant="secondary"
                icon={MessageCircle}
                onClick={() => resendTransactionWhatsApp('DELIVERY_PRODUCT_LIST', 'delivery')}
              >
                Resend delivery PDF
              </Button>
            ) : null}
            {hasMissingLines ? (
              <Button
                variant="secondary"
                icon={MessageCircle}
                onClick={() => resendTransactionWhatsApp('RETURN_MISSING_ITEMS', 'missing')}
              >
                Resend missing PDF
              </Button>
            ) : null}
            {showCancelOrderButton ? (
              <Button variant="danger" icon={XCircle} onClick={() => setCancelOpen(true)}>
                Cancel order
              </Button>
            ) : null}
          </div>
        }
      />

      <ReplacementRequirementsPanel orderId={order.id} />
      <ReplacementRequirementsPanel orderId={order.id} direction="source" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <StatBox
          label="Status"
          value={
            <Badge tone={ORDER_STATUS_BADGE_TONE[order.status] || 'brand'}>
              {ORDER_STATUS_LABELS[order.status] ?? order.status}
            </Badge>
          }
        />
        <StatBox label="Total" value={formatCurrency(order.total_amount)} />
        <StatBox label="Paid" value={formatCurrency(order.paid_amount)} />
        <StatBox
          label="Balance"
          value={
            <span className={Number(order.balance) > 0 ? 'text-red-600' : ''}>
              {formatCurrency(order.balance)}
            </span>
          }
        />
      </div>

      <div
        className={`card my-4 overflow-hidden transition-[box-shadow,background-color] duration-500 ${
          summaryHighlight ? 'bg-brand-light/50 shadow-[inset_0_0_0_2px_rgba(12,110,225,0.28)]' : ''
        }`}
      >
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5">
          <h2 className="text-sm font-bold text-gray-900">Order summary</h2>
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
            <section className="min-w-0 rounded-md border border-gray-200 bg-surface p-3">
              <h3 className="mb-2 border-b border-gray-200 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-600">
                Order &amp; customer
              </h3>
              <div>
                <SummaryRow label="Order No." value={order.order_number ?? '—'} />
                {linkedCustomOrders.length > 0 ? (
                  <SummaryRow
                    label="Custom order no."
                    value={
                      <span className="inline-flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
                        {linkedCustomOrders.map((co, idx) => (
                          <span key={co.id} className="inline-flex items-center gap-x-1">
                            {idx > 0 ? <span className="text-gray-400">,</span> : null}
                            <Link
                              to={`/custom-orders/${co.id}/edit`}
                              state={{
                                viewOnly: true,
                                returnTo: `/booking/${order.id}`,
                                returnLabel: 'Back to booking',
                              }}
                              className="font-mono text-brand hover:underline"
                            >
                              {co.order_number || '—'}
                            </Link>
                          </span>
                        ))}
                      </span>
                    }
                  />
                ) : null}
                <SummaryRow label="Customer Name" value={customer?.name || '—'} />
                <SummaryRow label="Contact No.1" value={contactSummary.contactNo1} />
                <SummaryRow label="Contact name 2" value={contactSummary.contact2Name} />
                <SummaryRow label="Contact No.2" value={contactSummary.contactNo2} />
                <SummaryRow label="Address" value={contactSummary.address} />
              </div>
            </section>
            <section className="min-w-0 rounded-md border border-gray-200 bg-surface p-3">
              <h3 className="mb-2 border-b border-gray-200 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-600">
                Dates &amp; amounts
              </h3>
              <div>
                <SummaryRow
                  label="Booking Date"
                  value={
                    order.booking_date
                      ? formatBookingDateTime(order.booking_date, order.booking_time) ||
                        formatDate(order.booking_date)
                      : '—'
                  }
                />
                <SummaryRow
                  label="Pickup Date"
                  value={order.pickup_date ? formatDate(order.pickup_date) : '—'}
                />
                <SummaryRow
                  label="Return Date"
                  value={order.return_date ? formatDate(order.return_date) : '—'}
                />
                <SummaryRow label="Total Amount" value={formatCurrency(order.total_amount || 0)} />
                <SummaryRow label="Paid Amount" value={formatCurrency(order.paid_amount || 0)} />
                <SummaryRow
                  label="Security deposit (expected)"
                  value={formatCurrency(order.deposit_amount || 0)}
                />
                <SummaryRow label="Subtotal" value={formatCurrency(order.subtotal || 0)} />
                <SummaryRow label="Tax Total" value={formatCurrency(order.tax_total || 0)} />
              </div>
            </section>
            <section className="min-w-0 rounded-md border border-gray-200 bg-surface p-3">
              <h3 className="mb-2 border-b border-gray-200 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-600">
                Discounts &amp; flags
              </h3>
              <div>
                <SummaryRow
                  label="Discount Total"
                  value={formatCurrency(order.discount_total || 0)}
                />
                <SummaryRow
                  label="Booking Discount"
                  value={formatCurrency(order.booking_discount_amount || 0)}
                />
                <SummaryRow
                  label="Next booking gap (days)"
                  value={String(order.next_booking_gap_days ?? 0)}
                />
                <SummaryRow
                  label="Previous booking gap (days)"
                  value={String(order.previous_booking_gap_days ?? 0)}
                />
                <SummaryRow
                  label="Paid security at booking"
                  value={yesNo(order.paid_security_amt)}
                />
                <SummaryRow
                  label="Deposit received (flag)"
                  value={order.deposit_received !== undefined ? yesNo(order.deposit_received) : '—'}
                />
                <SummaryRow
                  label="Deposit returned (flag)"
                  value={order.deposit_returned !== undefined ? yesNo(order.deposit_returned) : '—'}
                />
                <SummaryRow
                  label="GST Enabled"
                  value={order.gst_enabled !== false ? 'Yes' : 'No'}
                />
                <SummaryRow label="IGST Bill" value={order.igst_bill ? 'Yes' : 'No'} />
              </div>
            </section>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Items checklist</h3>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
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
                  saveStageMut.isPending || locked ||
                  order.status === 'cancelled' ||
                  allRows.length === 0 ||
                  !stageDraft
                }
              >
                {s.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleResetStages}
              disabled={
                order.status === 'cancelled' ||
                !isAnythingDirty ||
                saveStageMut.isPending ||
                locked
              }
            >
              Reset changes
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveStages}
              loading={saveStageMut.isPending}
              disabled={order.status === 'cancelled' || !isAnythingDirty || locked}
            >
              Save checklist
            </Button>
          </div>
        </div>
        {locked ? <div role="status" className="mb-3 space-y-2 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          <p>{refreshError || (checklist.pendingEntry ? 'This checklist is awaiting sync. The saved draft is shown below; further edits are locked until the action is confirmed or removed in Pending sync items.' : 'Refreshing the confirmed checklist before further edits.')} {checklist.pendingEntry?.error || checklist.pendingEntry?.blockedReason || ''}</p>
          {checklist.pendingEntry?.payload?.combined_assessment ? <p>Pending assessment: {formatCurrency(Number(checklist.pendingEntry.payload.combined_assessment.amount))}. {checklist.pendingEntry.payload.combined_assessment.remarks}</p> : null}
          {refreshError ? <Button size="sm" variant="secondary" onClick={() => void refreshDrafts()}>Refresh checklist</Button> : null}
        </div> : !checklist.isOnline ? <p className="mb-3 text-sm text-yellow-800">Offline changes will be saved on this device and validated during sync.</p> : null}
        <OrderChecklistPanel
          order={draftOrder}
          stageDraft={stageDraft}
          setStageDraft={setStageDraft}
          paymentAccountOptions={paymentAccountsQuery.data?.data || []}
          pendingConditionRows={pendingConditionRows}
          disabled={saveStageMut.isPending || locked || order.status === 'cancelled'}
          dense
          onStageIntentFailed={() => {}}
          conditionDraft={conditionDraft}
          onConditionDraftChange={handleConditionDraftChange}
        />
      </div>

      {order.customer_notes ? (
        <div className="card mt-4 border border-brand/40 bg-brand-light/40 p-4">
          <h3 className="mb-2 text-sm font-semibold text-brand">Notes</h3>
          <div className="rounded-md border border-brand/25 bg-surface px-3 py-2 text-xs text-gray-900 whitespace-pre-wrap">
            {order.customer_notes}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <PaymentsPanel
          order={order}
          disabled={order.status === 'cancelled'}
          onAddPayment={() => setSettlementOpen(true)}
        />
      </div>

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
        paymentAccountOptions={paymentAccountsQuery.data?.data || []}
        loading={saveStageMut.isPending}
      />
      <DeliverySettlementModal
        isOpen={deliverySettlementOpen}
        orderId={order.id}
        stageUpdates={deliveryStageUpdates}
        stageDraftAfter={deliveryStageDraftAfter}
        onClose={closeDeliverySettlement}
        onSuccess={async () => { closeDeliverySettlement(); const result = await refetchOrder(); if (result.data) resetDrafts(result.data); }}
      />
      <ReturnSettlementModal
        isOpen={returnSettlementOpen}
        orderId={order.id}
        stageUpdates={returnStageUpdates}
        stageDraftAfter={returnStageDraftAfter}
        conditionUpdates={returnConditionUpdates}
        onClose={closeReturnSettlement}
        onSuccess={async () => { closeReturnSettlement(); const result = await refetchOrder(); if (result.data) resetDrafts(result.data); }}
      />
      <SettlementModal
        isOpen={settlementOpen}
        orderId={order.id}
        onClose={() => setSettlementOpen(false)}
      />

      <CancelSummaryModal
        isOpen={cancelOpen}
        orderId={order.id}
        onClose={() => setCancelOpen(false)}
      />

      <AdminPasswordModal
        isOpen={adminPasswordOpen}
        title="Undo delivered / received"
        description="Unchecking Delivered or Received on items that were already marked requires Shop Admin approval."
        orderLabel={order.order_number || ''}
        shopName={selectedShopName}
        errorMessage={adminPasswordError}
        loading={saveStageMut.isPending}
        confirmLabel="Save changes"
        onClearError={() => setAdminPasswordError('')}
        onClose={handleAdminPasswordClose}
        onConfirm={handleAdminPasswordConfirm}
      />

      {tokenDownloadModal}
    </>
  );
};

const StatBox = ({ label, value }) => (
  <div className="card p-3">
    <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</div>
    <div className="text-lg font-semibold text-gray-900">{value}</div>
  </div>
);

const SummaryRow = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 py-2 last:border-b-0">
    <span className="shrink-0 text-xs font-bold text-gray-700">{label}</span>
    <span className="min-w-0 text-right text-sm font-bold leading-snug text-gray-900 break-words">
      {value}
    </span>
  </div>
);
SummaryRow.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
};

export default ProcessOrder;
