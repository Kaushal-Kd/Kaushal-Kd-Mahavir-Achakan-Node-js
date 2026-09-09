import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIONS,
  formatCurrency,
  formatDate,
  hasPermission,
  MODULES,
  normalizeTime12,
  parseOrderTimeTo24,
  toLocalISODate,
} from '@wrs/shared';
import clsx from 'clsx';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ShoppingCart,
  Truck,
  Undo2,
} from 'lucide-react';
import PropTypes from 'prop-types';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ActivityLogsCard from '../components/dashboard/ActivityLogsCard.jsx';
import CustomOrderTrialRemindersCard from '../components/dashboard/CustomOrderTrialRemindersCard.jsx';
import DashboardDraggableSection from '../components/dashboard/DashboardDraggableSection.jsx';
import DeferredMount from '../components/ui/DeferredMount.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Modal from '../components/ui/Modal.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import TableHeaderLabel from '../components/ui/TableHeaderLabel.jsx';
import SmartImage from '../components/ui/SmartImage.jsx';
import { ACCESSORY_BASE_PATH } from '../lib/accessoryRoutes.js';
import { dashboardApi } from '../lib/api/dashboard.js';
import { draftsApi } from '../lib/api/drafts.js';
import { queryKeys } from '../lib/queryKeys.js';
import { lazyRetry } from '../lib/lazyRetry.js';
import { remindersApi } from '../lib/api/reminders.js';
import {
  DASHBOARD_SECTION_LABELS,
  DEFAULT_DASHBOARD_SECTION_ORDER,
  loadDashboardSectionOrder,
  reorderDashboardSections,
  saveDashboardSectionOrder,
} from '../lib/dashboardSectionOrder.js';
import { dashboardPresetSearchParams } from '../lib/dashboardDateRanges.js';
import { useAppSettings } from '../hooks/useAppSettings.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore } from '../stores/shopStore.js';
import {
  formatReminderDateTime,
  isReminderDueOrPast,
  reminderSortKey,
} from '../lib/reminderDateTime.js';
import { toast, useUIStore } from '../stores/uiStore.js';

const CART_DRAFT_KIND = 'availability_cart';
/** Rows the calendar day list shows before it starts scrolling (max-h-96 ≈ 12 rows). */
const CALENDAR_EVENTS_VISIBLE_ROWS = 12;
/** Placeholder shown in place of booking earnings while they are hidden. */
const MASKED_EARNING = '₹••••••';
const EMPTY_EARNINGS_VISIBILITY = Object.freeze({});
const DashboardChart = lazyRetry(() => import('../components/dashboard/DashboardChart.jsx'));

const Dashboard = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canViewCustomOrders = hasPermission(user, MODULES.CUSTOM_ORDERS, ACTIONS.VIEW);
  const shopId = useShopStore((s) => s.selectedShopId);
  const [sectionOrder, setSectionOrder] = useState(() => loadDashboardSectionOrder(shopId));

  useEffect(() => {
    setSectionOrder(loadDashboardSectionOrder(shopId));
  }, [shopId]);

  const handleSectionReorder = useCallback(
    (dragId, targetId) => {
      setSectionOrder((prev) => {
        const next = reorderDashboardSections(dragId, targetId, prev);
        saveDashboardSectionOrder(shopId, next);
        return next;
      });
    },
    [shopId]
  );

  const resetSectionLayout = useCallback(() => {
    const next = [...DEFAULT_DASHBOARD_SECTION_ORDER];
    setSectionOrder(next);
    saveDashboardSectionOrder(shopId, next);
    toast.success('Dashboard layout reset');
  }, [shopId]);

  const { data: overview, isLoading } = useQuery({
    queryKey: ['dashboard', shopId],
    queryFn: () => dashboardApi.overview().then((r) => r.data),
    enabled: Boolean(shopId),
    refetchOnMount: 'always',
  });
  const appSettings = useAppSettings();
  const opsNavSettings = useMemo(
    () => ({
      itemToCollectDays: appSettings.getNumber('DASHBOARD_ITEM_TO_COLLECT_DAYS', 10),
      itemToPrepareDays: appSettings.getNumber('DASHBOARD_ITEM_TO_PREPARE_DAYS', 10),
      pendingDeliveryDays: appSettings.getNumber('DASHBOARD_PENDING_DELIVERY_DAYS', 9),
      pendingReturnDays: appSettings.getNumber('DASHBOARD_PENDING_RETURN_DAYS', 12),
    }),
    [appSettings.map]
  );
  const { data: cartRows, isLoading: cartLoading } = useQuery({
    queryKey: queryKeys.drafts.availabilityCart,
    queryFn: () => draftsApi.list({ kind: CART_DRAFT_KIND }).then((r) => r.data || []),
  });
  const todayIso = toLocalISODate(new Date());
  const pendingDelivery = overview?.pending_delivery || overview?.pending_delivery_9d;
  const pendingReturn = overview?.pending_return || overview?.pending_return_12d;
  const itemToCollect = overview?.item_to_collect;
  const itemToPrepare = overview?.item_to_prepare;
  const cartTotalProducts = useMemo(
    () =>
      (cartRows || []).reduce((sum, row) => {
        const qty = Number(row?.data?.qty || 1);
        return sum + (qty > 0 ? qty : 0);
      }, 0),
    [cartRows]
  );

  const todayDeliveriesValue = useMemo(() => {
    if (isLoading) return null;
    return formatTodayKpiWithDone(
      Number(overview?.today?.deliveries ?? 0),
      Number(overview?.today?.deliveries_completed ?? 0)
    );
  }, [isLoading, overview?.today?.deliveries, overview?.today?.deliveries_completed]);

  const todayReturnsValue = useMemo(() => {
    if (isLoading) return null;
    return formatTodayKpiWithDone(
      Number(overview?.today?.returns ?? 0),
      Number(overview?.today?.returns_completed ?? 0)
    );
  }, [isLoading, overview?.today?.returns, overview?.today?.returns_completed]);

  const renderDashboardSection = useCallback(
    (sectionId) => {
      switch (sectionId) {
        case 'kpi':
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <KpiCard
                label="Today Bookings"
                value={isLoading ? null : overview?.today?.bookings ?? 0}
                icon={CalendarCheck}
                onClick={() =>
                  navigate(`/booking?date_field=booking_date&from=${todayIso}&to=${todayIso}`)
                }
              />
              <KpiCard
                label="Today Deliveries"
                value={todayDeliveriesValue}
                icon={Truck}
                title="Pickups scheduled for today. The number in parentheses is already handed over (delivered or later)."
                onClick={() =>
                  navigate(`/delivery?from=${todayIso}&to=${todayIso}&drill=today`)
                }
              />
              <KpiCard
                label="Today Returns"
                value={todayReturnsValue}
                icon={Undo2}
                title="Returns scheduled for today. The number in parentheses is already received (returned or partially returned)."
                onClick={() =>
                  navigate(`/return?from=${todayIso}&to=${todayIso}&drill=today`)
                }
              />
              <KpiCard
                label="Total Product in Cart"
                value={isLoading || cartLoading ? null : cartTotalProducts}
                icon={ShoppingCart}
                tone="brand"
                onClick={() => navigate('/availability?tab=cart')}
              />
            </div>
          );
        case 'ops_stats':
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-4">
              <OpsStatCard
                title="Item to Collect"
                subtitle={
                  isLoading || !itemToCollect?.days
                    ? null
                    : `Next ${itemToCollect.days} days (upcoming pickups)`
                }
                badgeLabel={`${isLoading ? 0 : itemToCollect?.count ?? 0} Lines to collect`}
                badgeTone="brand"
                loading={isLoading}
                onClick={() =>
                  itemToCollect?.from && itemToCollect?.to
                    ? navigate(`/item-to-collect?from=${itemToCollect.from}&to=${itemToCollect.to}`)
                    : navigate(`/item-to-collect${dashboardPresetSearchParams('item_to_collect', opsNavSettings)}`)
                }
              />
              <OpsStatCard
                title="Items to Prepare"
                subtitle={
                  isLoading || !itemToPrepare?.days
                    ? null
                    : `Next ${itemToPrepare.days} days (upcoming pickups)`
                }
                badgeLabel={`${isLoading ? 0 : itemToPrepare?.count ?? 0} Bookings to prepare`}
                badgeTone="yellow"
                loading={isLoading}
                onClick={() =>
                  itemToPrepare?.from && itemToPrepare?.to
                    ? navigate(`/items-to-prepare?from=${itemToPrepare.from}&to=${itemToPrepare.to}`)
                    : navigate(`/items-to-prepare${dashboardPresetSearchParams('item_to_prepare', opsNavSettings)}`)
                }
              />
              <OpsStatCard
                title="Pending Delivery"
                subtitle={
                  isLoading || !pendingDelivery?.days
                    ? null
                    : `Last ${pendingDelivery.days} day's record`
                }
                badgeLabel={`${isLoading ? 0 : pendingDelivery?.count ?? 0} Deliveries remained to update`}
                badgeTone="red"
                loading={isLoading}
                onClick={() =>
                  pendingDelivery?.from && pendingDelivery?.to
                    ? navigate(
                        `/delivery?from=${pendingDelivery.from}&to=${pendingDelivery.to}&status=pending_delivery`
                      )
                    : navigate(`/delivery${dashboardPresetSearchParams('pending_delivery', opsNavSettings)}`)
                }
              />
              <OpsStatCard
                title="Pending Return"
                subtitle={
                  isLoading || !pendingReturn?.days
                    ? null
                    : `Last ${pendingReturn.days} day's record`
                }
                badgeLabel={`${isLoading ? 0 : pendingReturn?.count ?? 0} Returns remained to update`}
                badgeTone="red"
                loading={isLoading}
                onClick={() =>
                  pendingReturn?.from && pendingReturn?.to
                    ? navigate(
                        `/return?from=${pendingReturn.from}&to=${pendingReturn.to}&status=pending_return`
                      )
                    : navigate(`/return${dashboardPresetSearchParams('pending_return', opsNavSettings)}`)
                }
              />
            </div>
          );
        case 'reminders':
          return <RemindersCard />;
        case 'custom_order_trials':
          return canViewCustomOrders ? <CustomOrderTrialRemindersCard /> : null;
        case 'low_stock':
          return (
            <LowStockAccessoriesCard rows={overview?.low_stock_accessories} loading={isLoading} />
          );
        case 'bookings_chart':
          return (
            <DeferredMount minHeight={280}>
              <BookingsChartCard />
            </DeferredMount>
          );
        case 'calendar':
          return (
            <DeferredMount minHeight={320}>
              <CalendarCard />
            </DeferredMount>
          );
        case 'booking_earning':
          return (
            <DeferredMount minHeight={280}>
              <BookingEarningCard />
            </DeferredMount>
          );
        case 'activity_logs':
          return (
            <DeferredMount minHeight={240}>
              <ActivityLogsCard />
            </DeferredMount>
          );
        default:
          return null;
      }
    },
    [
      isLoading,
      overview,
      todayDeliveriesValue,
      todayReturnsValue,
      cartLoading,
      cartTotalProducts,
      todayIso,
      navigate,
      itemToCollect,
      itemToPrepare,
      pendingDelivery,
      pendingReturn,
      opsNavSettings,
      canViewCustomOrders,
    ]
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of today's operations"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className="text-xs text-gray-500">
          Drag sections by the grip to reorder your dashboard.
        </p>
        <button
          type="button"
          onClick={resetSectionLayout}
          className="text-xs font-medium text-brand hover:underline"
        >
          Reset layout
        </button>
      </div>

      {sectionOrder.map((sectionId) => {
        if (sectionId === 'custom_order_trials' && !canViewCustomOrders) return null;
        return (
          <DashboardDraggableSection
            key={sectionId}
            id={sectionId}
            title={DASHBOARD_SECTION_LABELS[sectionId] || sectionId}
            onReorder={handleSectionReorder}
          >
            {renderDashboardSection(sectionId)}
          </DashboardDraggableSection>
        );
      })}
    </>
  );
};

const REMINDER_CELL = 'px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis align-middle';

const RemindersCard = () => {
  const qc = useQueryClient();
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleRow, setRescheduleRow] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reminders'],
    queryFn: () => remindersApi.list(),
    refetchOnMount: 'always',
  });

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const reminders = useMemo(() => {
    const rows = data?.data || [];
    const now = new Date(nowTick);
    return rows
      .filter((row) => {
        if (row.is_completed) return false;
        // "Due now" list should only show reminders that have an explicit date + time.
        if (!row.reminder_date) return false;
        if (!row.reminder_time) return false;
        return isReminderDueOrPast(row, now);
      })
      .sort((a, b) => reminderSortKey(a).localeCompare(reminderSortKey(b)));
  }, [data, nowTick]);
  const shouldScroll = reminders.length > 10;

  const completeMut = useMutation({
    mutationFn: async (row) =>
      remindersApi.update(row.id, {
        description: row.description || '',
        assignee: row.assignee || '',
        reminder_date: String(row.reminder_date || '').slice(0, 10),
        reminder_time: row.reminder_time || undefined,
        is_completed: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      toast.success('Reminder marked as complete');
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error?.message || 'Could not mark reminder complete');
    },
  });

  const rescheduleMut = useMutation({
    mutationFn: async ({ row, reminder_date, reminder_time }) =>
      remindersApi.update(row.id, {
        description: row.description || '',
        assignee: row.assignee || '',
        reminder_date: String(reminder_date || '').slice(0, 10),
        reminder_time: reminder_time || undefined,
        is_completed: false,
      }),
    onSuccess: (_resp, variables) => {
      const updatedId = variables.row.id;
      qc.setQueryData(['reminders'], (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((r) =>
            r.id === updatedId
              ? { ...r, reminder_date: variables.reminder_date, reminder_time: variables.reminder_time }
              : r
          ),
        };
      });
      qc.invalidateQueries({ queryKey: ['reminders'] });
      toast.success('Reminder rescheduled');
      setRescheduleOpen(false);
      setRescheduleRow(null);
      setRescheduleDate('');
      setRescheduleTime('');
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error?.message || 'Could not reschedule reminder');
    },
  });

  const openReschedule = (row) => {
    setRescheduleRow(row);
    setRescheduleDate(String(row?.reminder_date || '').slice(0, 10) || '');
    setRescheduleTime(parseOrderTimeTo24(row?.reminder_time) || '');
    setRescheduleOpen(true);
  };

  const submitReschedule = () => {
    if (!rescheduleRow) return;
    if (!rescheduleDate) {
      toast.warning('Select reminder date');
      return;
    }
    if (!rescheduleTime) {
      toast.warning('Select reminder time');
      return;
    }
    const time12 = rescheduleTime ? normalizeTime12(rescheduleTime) : '';
    rescheduleMut.mutate({
      row: rescheduleRow,
      reminder_date: rescheduleDate,
      reminder_time: time12 || undefined,
    });
  };

  return (
    <Card padded>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-900">All Reminders</h3>
        <span className="text-xs text-gray-500">{reminders.length} due now</span>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : isError ? (
        <div className="text-sm text-gray-500 py-6 text-center">Could not load reminders.</div>
      ) : reminders.length === 0 ? (
        <div className="text-sm text-gray-500 py-6 text-center">No due reminders right now.</div>
      ) : (
        <div
          className={clsx(
            'rounded-md border border-gray-200 overflow-x-auto',
            shouldScroll && 'max-h-80 overflow-y-auto'
          )}
        >
          <table className="table w-full text-sm table-fixed min-w-[760px]">
            <thead>
              <tr>
                <th className={`text-left ${REMINDER_CELL} w-[38%]`}>
                  <TableHeaderLabel>Description</TableHeaderLabel>
                </th>
                <th className={`text-left ${REMINDER_CELL} w-[18%]`}>
                  <TableHeaderLabel>Assignee</TableHeaderLabel>
                </th>
                <th className={`text-left ${REMINDER_CELL} w-[20%]`}>
                  <TableHeaderLabel>Date & time</TableHeaderLabel>
                </th>
                <th className={`text-center ${REMINDER_CELL} w-[24%]`}>
                  <TableHeaderLabel align="center">Actions</TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reminders.map((row) => {
                const completed = Boolean(row.is_completed);
                const busy = completeMut.isPending && completeMut.variables?.id === row.id;
                const rescheduleBusy =
                  rescheduleMut.isPending && rescheduleRow?.id && rescheduleRow.id === row.id;
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td
                      className={clsx(
                        REMINDER_CELL,
                        'max-w-0',
                        completed ? 'text-gray-500 line-through' : 'text-gray-900'
                      )}
                      title={row.description || ''}
                    >
                      {row.description || '—'}
                    </td>
                    <td
                      className={clsx(REMINDER_CELL, 'text-gray-800 max-w-0')}
                      title={row.assignee || ''}
                    >
                      {row.assignee || '—'}
                    </td>
                    <td className={clsx(REMINDER_CELL, 'text-gray-700 tabular-nums')}>
                      {formatReminderDateTime(row.reminder_date, row.reminder_time)}
                    </td>
                    <td className={clsx(REMINDER_CELL, 'text-center')}>
                      {completed ? (
                        <span className="inline-flex items-center justify-center text-green-600">
                          <CheckCircle2 size={16} />
                        </span>
                      ) : (
                        <div className="w-full inline-flex items-center justify-center gap-2 flex-nowrap whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openReschedule(row)}
                            loading={rescheduleBusy}
                            className="min-w-[7.25rem] px-2"
                          >
                            Reschedule
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => completeMut.mutate(row)}
                            loading={busy}
                            className="min-w-[7.25rem] px-2"
                          >
                            Mark complete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={rescheduleOpen}
        onClose={() => {
          if (rescheduleMut.isPending) return;
          setRescheduleOpen(false);
          setRescheduleRow(null);
        }}
        title="Reschedule reminder"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (rescheduleMut.isPending) return;
                setRescheduleOpen(false);
                setRescheduleRow(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitReschedule} loading={rescheduleMut.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-gray-900 font-medium">
            {rescheduleRow?.description || 'Reminder'}
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="label">Date</div>
              <input
                type="date"
                className="input"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
              />
            </div>
            <div>
              <div className="label">Time (optional)</div>
              <input
                type="time"
                className="input"
                value={rescheduleTime}
                onChange={(e) => setRescheduleTime(e.target.value)}
              />
            </div>
          </div>
        </div>
      </Modal>
    </Card>
  );
};

const BookingsChartCard = () => {
  const months = useMemo(() => getLast12Months(), []);
  const trendQuery = useQuery({
    queryKey: queryKeys.dashboard.bookingsTrend(12),
    queryFn: () => dashboardApi.calendarBookingsTrend({ months: 12 }).then((r) => r.data || []),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
  });

  const loading = trendQuery.isLoading;
  const hasError = trendQuery.isError;
  const trendByKey = useMemo(() => {
    const map = new Map();
    for (const row of trendQuery.data || []) {
      map.set(String(row.month), Number(row.bookings || 0));
    }
    return map;
  }, [trendQuery.data]);

  const chartData = useMemo(
    () =>
      months.map((month) => ({
        month: month.label,
        bookings: trendByKey.get(month.key) || 0,
      })),
    [months, trendByKey]
  );

  const avg = useMemo(() => {
    if (!chartData.length) return 0;
    return chartData.reduce((sum, row) => sum + row.bookings, 0) / chartData.length;
  }, [chartData]);

  const empty = !loading && !hasError && chartData.every((d) => d.bookings === 0);

  return (
    <Card padded>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Bookings</h3>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : hasError ? (
        <div className="h-64 flex items-center justify-center text-sm text-gray-500">
          Could not load booking trend.
        </div>
      ) : empty ? (
        <div className="h-64 flex items-center justify-center text-sm text-gray-500">
          No bookings in last 12 months.
        </div>
      ) : (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <DashboardChart variant="bookings" data={chartData} average={avg} />
        </Suspense>
      )}
    </Card>
  );
};

const BookingEarningCard = () => {
  const monthOptions = useMemo(() => getRecentMonthOptions(12), []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.key || '');
  const userId = useAuthStore((s) => s.user?.id || 'anonymous');
  const shopId = useShopStore((s) => s.selectedShopId || 'no-shop');
  const visibilityScope = `${userId}:${shopId}`;
  const earningsVisibility = useUIStore(
    (s) => s.earningsVisibility?.[visibilityScope] || EMPTY_EARNINGS_VISIBILITY
  );
  const setEarningsVisibility = useUIStore((s) => s.setEarningsVisibility);
  const currentVisible = earningsVisibility.current === true;
  const lastVisible = earningsVisibility.last === true;
  const totalVisible = earningsVisibility.total === true;
  const showAmount = (value, visible) => (visible ? formatCurrency(value) : MASKED_EARNING);
  const toggleVisibility = (field, visible) =>
    setEarningsVisibility(visibilityScope, field, !visible);

  const selectedDate = useMemo(() => parseMonthKey(selectedMonth), [selectedMonth]);
  const previousDate = useMemo(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1),
    [selectedDate]
  );
  const rangeDays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(previousDate.getFullYear(), previousDate.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const diff = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
    return Math.max(30, Math.min(365, diff));
  }, [previousDate]);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.dashboard.bookingEarning(rangeDays),
    queryFn: () => dashboardApi.revenueSeries({ days: rangeDays }).then((r) => r.data || []),
    enabled: Boolean(selectedMonth),
    refetchOnMount: 'always',
  });

  const thisMonthSeries = useMemo(() => {
    const monthPrefix = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;
    const filtered = (data || []).filter((row) => String(row.date || '').startsWith(monthPrefix));
    return filtered.map((row) => {
      const day = Number(String(row.date || '').slice(8, 10)) || 0;
      return {
        date: row.date,
        day,
        dayLabel: String(day),
        amount: Number(row.total || 0),
      };
    });
  }, [data, selectedDate]);

  const thisMonthTotal = useMemo(
    () => thisMonthSeries.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [thisMonthSeries]
  );

  const lastMonthTotal = useMemo(() => {
    const monthPrefix = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
    return (data || [])
      .filter((row) => String(row.date || '').startsWith(monthPrefix))
      .reduce((sum, row) => sum + Number(row.total || 0), 0);
  }, [data, previousDate]);

  const deltaPct = useMemo(() => {
    if (!lastMonthTotal) return thisMonthTotal > 0 ? 100 : 0;
    return ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100;
  }, [thisMonthTotal, lastMonthTotal]);

  const empty = !isLoading && !isError && thisMonthSeries.length === 0;

  return (
    <Card padded>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
        <div className="min-w-[220px]">
          <h3 className="text-2xl font-semibold text-gray-900">Booking Earning</h3>
          <div className="mt-4">
            <p className="text-sm text-gray-500">This month</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-4xl font-semibold text-gray-900">
                {showAmount(thisMonthTotal, currentVisible)}
              </p>
              <button
                type="button"
                onClick={() => toggleVisibility('current', currentVisible)}
                className="shrink-0 text-gray-400 hover:text-brand"
                title={currentVisible ? 'Hide current month earnings' : 'Show current month earnings'}
                aria-label={currentVisible ? 'Hide current month earnings' : 'Show current month earnings'}
                aria-pressed={currentVisible}
              >
                {currentVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p
              className={clsx(
                'text-sm mt-2 inline-flex px-2 py-0.5 rounded',
                deltaPct < 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
              )}
            >
              {deltaPct >= 0 ? '+' : '-'}
              {Math.abs(deltaPct).toFixed(2)}% From previous period
            </p>
          </div>
          <div className="mt-5">
            <p className="text-sm text-gray-500">Last month</p>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-2xl font-semibold text-gray-900">
                {showAmount(lastMonthTotal, lastVisible)}
              </p>
              <button
                type="button"
                onClick={() => toggleVisibility('last', lastVisible)}
                className="shrink-0 text-gray-400 hover:text-brand"
                title={lastVisible ? 'Hide last month earnings' : 'Show last month earnings'}
                aria-label={lastVisible ? 'Hide last month earnings' : 'Show last month earnings'}
                aria-pressed={lastVisible}
              >
                {lastVisible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-800">
              <span className="truncate">
                Total Amount: {showAmount(thisMonthTotal, totalVisible)}
              </span>
              <button
                type="button"
                onClick={() => toggleVisibility('total', totalVisible)}
                className="shrink-0 text-gray-400 hover:text-brand"
                title={totalVisible ? 'Hide total amount' : 'Show total amount'}
                aria-label={totalVisible ? 'Hide total amount' : 'Show total amount'}
                aria-pressed={totalVisible}
              >
                {totalVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <select
              className="border border-gray-200 rounded px-2 py-1.5 bg-white text-xs"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {monthOptions.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : isError ? (
            <div className="h-72 flex items-center justify-center text-sm text-gray-500">
              Could not load earning trend.
            </div>
          ) : empty ? (
            <div className="h-72 flex items-center justify-center text-sm text-gray-500">
              No earning data for selected month.
            </div>
          ) : (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <DashboardChart
                variant="earnings"
                data={thisMonthSeries}
                masked={!currentVisible}
                onChartClick={() => toggleVisibility('current', currentVisible)}
              />
            </Suspense>
          )}
        </div>
      </div>
    </Card>
  );
};

const CalendarCard = () => {
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const monthParam = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.dashboard.calendar(monthParam),
    queryFn: () => dashboardApi.calendar({ month: monthParam }).then((r) => r.data),
    refetchOnMount: 'always',
  });

  const grid = useMemo(() => {
    const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const startOffset = firstDay.getDay();
    const cells = [];
    for (let i = 0; i < startOffset; i += 1) cells.push(null);
    for (let d = 1; d <= lastDay.getDate(); d += 1) {
      const date = new Date(cursor.getFullYear(), cursor.getMonth(), d);
      cells.push({
        day: d,
        iso: toLocalISODate(date),
        weekend: date.getDay() === 0 || date.getDay() === 6,
      });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [cursor]);

  const events = data?.events || {};
  const todayISO = toLocalISODate(new Date());
  const shift = (n) => {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + n);
    setCursor(d);
  };

  const [selected, setSelected] = useState(todayISO);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const dayEvents = events[selected] || [];
  const canExpandEvents = dayEvents.length > CALENDAR_EVENTS_VISIBLE_ROWS;

  const selectDay = (iso) => {
    setSelected(iso);
    setShowAllEvents(false);
  };

  return (
    <Card padded>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <CalendarCheck size={16} className="text-brand" />{' '}
          {cursor.toLocaleString('default', { month: 'long', year: 'numeric' })}
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => shift(-1)}
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => {
              const d = new Date();
              d.setDate(1);
              setCursor(d);
              selectDay(todayISO);
            }}
            className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-700"
          >
            Today
          </button>
          <button
            onClick={() => shift(1)}
            className="p-1 rounded hover:bg-gray-100 text-gray-600"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1 px-1">
      <div className="min-w-[280px]">
      <div className="grid grid-cols-7 gap-1 text-[10px] sm:text-[11px] text-gray-500 uppercase font-semibold mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell, idx) => {
          if (!cell) return <div key={`pad-${idx}`} />;
          const evts = events[cell.iso] || [];
          const types = new Set(evts.map((e) => e.type));
          const bookingCount = evts.filter((e) => e.type === 'booking').length;
          const pickupCount = evts.filter((e) => e.type === 'pickup').length;
          const returnCount = evts.filter((e) => e.type === 'return').length;
          const isToday = cell.iso === todayISO;
          const isSelected = cell.iso === selected;
          return (
            <button
              key={cell.iso}
              onClick={() => selectDay(cell.iso)}
              className={clsx(
                'h-14 rounded-md border text-sm flex flex-col items-center justify-start p-1 transition-colors',
                isSelected
                  ? 'border-brand bg-brand-light'
                  : isToday
                  ? 'border-brand/50 bg-white'
                  : 'border-gray-100 bg-white hover:bg-gray-50',
                cell.weekend ? 'text-gray-500' : 'text-gray-800'
              )}
            >
              <span className={clsx('font-semibold text-sm', isToday && 'text-brand')}>{cell.day}</span>
              <span className="flex flex-wrap items-center justify-center gap-1 mt-1 text-[11px] font-semibold leading-none">
                {types.has('booking') ? (
                  <span className="inline-flex items-center gap-0.5">
                    <Dot color="bg-brand" />
                    {bookingCount}
                  </span>
                ) : null}
                {types.has('pickup') ? (
                  <span className="inline-flex items-center gap-0.5">
                    <Dot color="bg-amber-500" />
                    {pickupCount}
                  </span>
                ) : null}
                {types.has('return') ? (
                  <span className="inline-flex items-center gap-0.5">
                    <Dot color="bg-green-500" />
                    {returnCount}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      </div>
      </div>

      <Legend />

      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-base font-semibold text-gray-700">
            {formatDate(selected)} · {dayEvents.length} event{dayEvents.length === 1 ? '' : 's'}
          </div>
          {canExpandEvents ? (
            <button
              type="button"
              onClick={() => setShowAllEvents((v) => !v)}
              className="shrink-0 text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-700"
            >
              {showAllEvents ? 'Show less' : `Show all (${dayEvents.length})`}
            </button>
          ) : null}
        </div>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : dayEvents.length === 0 ? (
          <div className="text-sm text-gray-500">Nothing scheduled.</div>
        ) : (
          <ul
            className={clsx('space-y-1', !showAllEvents && 'max-h-96 scroll-area')}
          >
            {dayEvents.map((e, i) => {
              const eventLabel = formatCalendarEventLabel(e);
              return (
              <li key={`${e.type}-${e.id}-${i}`}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-gray-50"
                  onClick={() => e.id && navigate(`/booking/${e.id}`)}
                  title={eventLabel}
                >
                  <Dot color={EVT_COLOR[e.type] || 'bg-gray-400'} />
                  <span className="w-16 shrink-0 capitalize text-gray-600 sm:w-20">{e.type}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-800">
                    {eventLabel}
                  </span>
                </button>
              </li>
            );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
};

const LowStockAccessoriesCard = ({ rows = [], loading = false }) => {
  const navigate = useNavigate();
  const list = Array.isArray(rows) ? rows : [];
  const shouldScroll = list.length > 8;
  const hasLowStock = !loading && list.length > 0;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className={clsx('flex items-center gap-2', hasLowStock && 'dash-low-stock-header')}>
          <div
            className={clsx(
              'w-8 h-8 rounded-md flex items-center justify-center',
              hasLowStock ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-400'
            )}
          >
            <AlertTriangle size={16} aria-hidden />
          </div>
          <div>
            <h3
              className={clsx(
                'text-sm font-semibold',
                hasLowStock ? 'text-red-700' : 'text-gray-700'
              )}
            >
              Accessories — low stock
            </h3>
            <p className="text-xs text-gray-500">In-shop qty below the item low stock alert level</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate(ACCESSORY_BASE_PATH)}>
          View accessories
        </Button>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">All accessories are at or above their low stock alert level.</p>
      ) : (
        <ul
          className={clsx(
            'divide-y divide-gray-100 border border-gray-200 rounded-md',
            shouldScroll && 'max-h-64 overflow-y-auto'
          )}
        >
          {list.map((row) => {
            const inShop = Number(row.in_shop_qty ?? row.qty ?? 0);
            const outQty = Number(row.active_out_qty ?? 0);
            const threshold = Number(row.threshold ?? 0);
            const spareQty = Number(row.spare_qty ?? 0);
            const rentableQty = Number(row.rentable_qty ?? Math.max(0, Number(row.qty ?? 0) - spareQty));
            return (
              <li key={row.id} className="dash-low-stock-row">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-red-100 transition-colors"
                  onClick={() => navigate(`${ACCESSORY_BASE_PATH}/${row.id}/edit`)}
                >
                  <SmartImage
                    src={row.image_url || ''}
                    alt={row.name || 'Accessory'}
                    className="w-8 h-8 rounded border border-gray-200 bg-white object-contain shrink-0"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">{row.name}</span>
                    {row.category_name ? (
                      <span className="block text-[11px] text-gray-500 truncate">{row.category_name}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-red-700 font-medium tabular-nums">
                      {inShop} in shop / {threshold} alert
                    </span>
                    {outQty > 0 ? (
                      <span className="block text-[10px] text-yellow-700 tabular-nums">
                        {outQty} out on orders
                      </span>
                    ) : null}
                    {spareQty > 0 ? (
                      <span className="block text-[10px] text-gray-500 tabular-nums">
                        {spareQty} spare · {rentableQty} rentable
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

LowStockAccessoriesCard.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object),
  loading: PropTypes.bool,
};

const EVT_COLOR = {
  booking: 'bg-brand',
  pickup: 'bg-amber-500',
  return: 'bg-green-500',
};

const Dot = ({ color }) => <span className={clsx('inline-block w-1.5 h-1.5 rounded-full', color)} />;

const Legend = () => (
  <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-500">
    <span className="flex items-center gap-1"><Dot color="bg-brand" /> Booking</span>
    <span className="flex items-center gap-1"><Dot color="bg-amber-500" /> Pickup</span>
    <span className="flex items-center gap-1"><Dot color="bg-green-500" /> Return</span>
  </div>
);

const KpiCard = ({
  label,
  value = null,
  icon: Icon,
  tone = 'brand',
  title = '',
  onClick = undefined,
}) => (
  <button
    type="button"
    title={title || undefined}
    onClick={onClick}
    className={clsx(
      'card p-4 text-left w-full',
      onClick ? 'cursor-pointer hover:bg-gray-50 transition-colors' : 'cursor-default'
    )}
  >
    <div className="flex items-center justify-between mb-2">
      <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</div>
      <div
        className={`w-8 h-8 rounded-md flex items-center justify-center ${
          tone === 'yellow' ? 'bg-yellow-50 text-yellow-700' : 'bg-brand-light text-brand'
        }`}
      >
        <Icon size={16} />
      </div>
    </div>
    <div className="text-2xl font-semibold text-gray-900">
      {value == null ? <Skeleton className="h-7 w-24" /> : value}
    </div>
  </button>
);

KpiCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  icon: PropTypes.elementType.isRequired,
  tone: PropTypes.oneOf(['brand', 'yellow']),
  title: PropTypes.string,
  onClick: PropTypes.func,
};

const OpsStatCard = ({ title, subtitle, badgeLabel, badgeTone = 'green', loading, onClick }) => {
  const badgeClass =
    badgeTone === 'red'
      ? 'bg-red-100 text-red-700'
      : badgeTone === 'brand'
        ? 'bg-brand-light text-brand'
        : badgeTone === 'yellow'
          ? 'bg-yellow-100 text-yellow-800'
          : 'bg-green-100 text-green-700';

  return (
  <button
    type="button"
    onClick={onClick}
    className={clsx('card p-5 text-left w-full', onClick ? 'cursor-pointer hover:bg-gray-50 transition-colors' : '')}
  >
    <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
    {loading ? (
      <Skeleton className="h-4 w-40 mb-4" />
    ) : (
      <p className="text-sm text-gray-500 mb-4">{subtitle}</p>
    )}
    {loading ? (
      <Skeleton className="h-5 w-48" />
    ) : (
      <span className={clsx('inline-flex rounded px-2 py-0.5 text-xs font-medium', badgeClass)}>
        {badgeLabel}
      </span>
    )}
  </button>
  );
};

export default Dashboard;

function formatTodayKpiWithDone(total, done) {
  if (total <= 0) return 0;
  return (
    <span className="tabular-nums">
      {total}
      <span className="text-lg font-semibold text-gray-500 ml-1">({done})</span>
    </span>
  );
}

function formatIsoDDMMYYYY(iso) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}-${m}-${y}`;
}

function getLast12Months() {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'short' });
    months.push({ key, label });
  }
  return months;
}

function getRecentMonthOptions(count = 12) {
  const now = new Date();
  const options = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('default', { month: 'long', year: 'numeric' }),
    });
  }
  return options;
}

function parseMonthKey(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

/** Booking no., customer, and address on one line for calendar day list. */
function formatCalendarEventLabel(evt) {
  const parts = [];
  const orderNo = String(evt?.order_number || '').trim();
  if (orderNo) parts.push(orderNo);
  const name = String(evt?.customer_name || evt?.pickup_name || '').trim();
  if (name) parts.push(name);
  const address = String(evt?.customer_address || '').trim();
  if (address) parts.push(address);
  return parts.length ? parts.join(' · ') : '—';
}
