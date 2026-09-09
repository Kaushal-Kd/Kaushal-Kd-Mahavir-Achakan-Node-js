import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@wrs/shared';
import { ArrowLeft, ChevronDown, ChevronRight, Pencil, Printer } from 'lucide-react';
import PropTypes from 'prop-types';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import VendorOutstandingSummary from '../../components/laundry/VendorOutstandingSummary.jsx';
import UpcomingPickupDates from '../../components/booking/UpcomingPickupDates.jsx';
import Button from '../../components/ui/Button.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { laundryApi } from '../../lib/api/laundry.js';
import { toast } from '../../stores/uiStore.js';
import { formatLaundrySlipDateTime } from './laundrySlipData.js';
import {
  getDaysLeft,
  groupLaundryAccessoriesByCategory,
  PRIORITY_TONE,
  resolveNextBookingLink,
} from './laundryQueueUtils.js';
import { printLaundrySlip } from './laundrySlipPrint.js';

const STATUS_BADGE = {
  in_washing: 'bg-blue-100 text-blue-700',
  returned: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

const STATUS_LABEL = {
  in_washing: 'In Washing',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

const JOB_STATUS_BADGE = {
  completed: 'bg-green-100 text-green-700',
  open: 'bg-blue-100 text-blue-700',
};

function formatDaysLeft(row) {
  if (row.daysLeft != null && row.daysLeft !== '') return String(row.daysLeft);
  const computed = getDaysLeft(row.nextPickupDate);
  return computed == null ? '—' : String(computed);
}

const DetailField = ({ label, value, mono = false }) => (
  <div>
    <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
    <div className={`text-xs text-gray-900 mt-0.5 ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
  </div>
);

DetailField.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  mono: PropTypes.bool,
};

const ViewLaundryJobPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [expandedAccessoryCategories, setExpandedAccessoryCategories] = useState(new Set());

  const { data: jobResp, isLoading } = useQuery({
    queryKey: ['laundry-job', id],
    queryFn: () => laundryApi.get(id),
    enabled: Boolean(id),
  });

  const job = jobResp?.data;
  const productRows = job?.productRows || [];
  const accessoryRows = job?.accessoryRows || [];
  const accessoryGroups = useMemo(
    () => groupLaundryAccessoriesByCategory(accessoryRows),
    [accessoryRows]
  );
  const categorySummaries = job?.categorySummaries || [];

  const discountLabel =
    job?.discountMode === 'percent'
      ? `${Number(job.discountValue || 0)}%`
      : formatCurrency(Number(job?.discountValue || 0));

  const handlePrint = () => {
    if (!job) return;
    try {
      printLaundrySlip(job);
    } catch (e) {
      toast.error(e?.message || 'Failed to print');
    }
  };

  return (
    <>
      <PageHeader
        title="Laundry Management / View Job"
        description={`Dashboard / Laundry / ${job?.jobNo || id || '…'}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={ArrowLeft}
              onClick={() => navigate('/laundry')}
            >
              Back
            </Button>
            {job ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Pencil}
                  onClick={() => navigate(`/laundry/new?jobId=${job.id}`)}
                >
                  Edit
                </Button>
                <Button size="sm" variant="secondary" icon={Printer} onClick={handlePrint}>
                  Print
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-gray-500 py-10 text-center">Loading job details...</p>
      ) : !job ? (
        <p className="text-sm text-gray-500 py-10 text-center">Laundry job not found.</p>
      ) : (
        <div className="space-y-3 pb-8 text-xs">
          <section className="card p-3">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span
                className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${
                  JOB_STATUS_BADGE[job.status] || JOB_STATUS_BADGE.open
                }`}
              >
                {job.status === 'completed' ? 'Completed' : 'Open'}
              </span>
              <span className="text-gray-500">
                Created{' '}
                {formatLaundrySlipDateTime(job.createdAt) || formatDate(job.createdAt) || '—'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <DetailField label="Laundry date" value={formatDate(job.laundryDate)} />
              <DetailField label="Job no" value={job.jobNo} mono />
              <DetailField label="Vendor" value={job.vendorName} />
              <DetailField label="Pickup by" value={job.pickupBy} />
              <DetailField
                label="Pickup date & time"
                value={formatLaundrySlipDateTime(job.pickupAt)}
              />
              <DetailField
                label="Return date & time"
                value={formatLaundrySlipDateTime(job.returnAt)}
              />
            </div>
          </section>

          {job.remarks ? (
            <section className="card p-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Remarks</div>
              <p className="text-xs text-gray-800 whitespace-pre-wrap">{job.remarks}</p>
            </section>
          ) : null}

          <section className="card p-3">
            <h3 className="text-xs font-semibold text-gray-900 mb-2 uppercase">Totals</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <DetailField label="Product total" value={formatCurrency(job.productTotal)} />
              <DetailField label="Accessory total" value={formatCurrency(job.accessoryTotal)} />
              <DetailField label="Subtotal" value={formatCurrency(job.subtotal)} />
              <DetailField
                label="Discount"
                value={`${discountLabel} (${formatCurrency(job.discountAmount)})`}
              />
              <DetailField label="Payable" value={formatCurrency(job.payable)} />
              <DetailField label="Paid to washing" value={formatCurrency(job.paidToWashing)} />
              <DetailField label="Remaining" value={formatCurrency(job.washingBalance)} />
            </div>
          </section>

          {job.vendorOutstanding ? (
            <VendorOutstandingSummary
              vendorOutstanding={job.vendorOutstanding}
              currentBillAmount={job.payable}
              currentBillId={job.id}
            />
          ) : null}

          {categorySummaries.length > 0 ? (
            <section className="card p-3">
              <h3 className="text-xs font-semibold text-gray-900 mb-2 uppercase">
                Category wash rates
              </h3>
              <div className="border border-gray-200 rounded overflow-auto">
                <table className="table w-full text-[11px]">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-2">
                        <TableHeaderLabel>Category</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Products</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Qty</TableHeaderLabel>
                      </th>
                      <th className="text-right px-2">
                        <TableHeaderLabel align="right">Rate</TableHeaderLabel>
                      </th>
                      <th className="text-right px-2">
                        <TableHeaderLabel align="right">Total</TableHeaderLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {categorySummaries.map((row) => (
                      <tr key={row.key} className="border-t border-gray-100">
                        <td className="px-2">{row.label}</td>
                        <td className="px-2 text-center">{row.productCount}</td>
                        <td className="px-2 text-center">{row.qtyTotal}</td>
                        <td className="px-2 text-right">{formatCurrency(row.washPrice)}</td>
                        <td className="px-2 text-right">{formatCurrency(row.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="card p-3">
            <h3 className="text-xs font-semibold text-gray-900 mb-2 uppercase">
              Products ({productRows.length})
            </h3>
            {productRows.length === 0 ? (
              <p className="text-gray-500 py-2">No products in this job.</p>
            ) : (
              <div className="border border-gray-200 rounded overflow-auto">
                <table className="table w-full text-[11px] min-w-[48rem]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 w-10" />
                      <th className="text-left px-2">
                        <TableHeaderLabel>Code</TableHeaderLabel>
                      </th>
                      <th className="text-left px-2">
                        <TableHeaderLabel>Name</TableHeaderLabel>
                      </th>
                      <th className="text-left px-2">
                        <TableHeaderLabel>Category</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Qty</TableHeaderLabel>
                      </th>
                      <th className="text-left px-2">
                        <TableHeaderLabel>Next booking</TableHeaderLabel>
                      </th>
                      <th className="text-left px-2">
                        <TableHeaderLabel>Next pickup</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Days left</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Priority</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Status</TableHeaderLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map((row) => {
                      const priority = row.priority || 'No Schedule';
                      const status = row.status || 'in_washing';
                      return (
                        <tr key={row.rowId} className="border-t border-gray-100">
                          <td className="px-2">
                            <SmartImage
                              src={row.image}
                              alt={row.name}
                              className="w-8 h-8 rounded object-contain border border-gray-100 bg-gray-50"
                            />
                          </td>
                          <td className="px-2 font-mono">{row.code || '—'}</td>
                          <td className="px-2">{row.name || '—'}</td>
                          <td className="px-2 text-gray-600">
                            {row.categoryLabel || 'Uncategorized'}
                          </td>
                          <td className="px-2 text-center">{row.qty}</td>
                          <td className="px-2">
                            {(() => {
                              const next = resolveNextBookingLink(row);
                              return (
                                <BookingBillLink orderId={next.orderId}>
                                  {next.label || '—'}
                                </BookingBillLink>
                              );
                            })()}
                          </td>
                          <td className="px-2">
                            <UpcomingPickupDates bookings={row.upcomingBookings} />
                          </td>
                          <td className="px-2 text-center">{formatDaysLeft(row)}</td>
                          <td className="px-2 text-center">
                            <span
                              className={`rounded px-1 py-0.5 ${
                                PRIORITY_TONE[priority] || PRIORITY_TONE['No Schedule']
                              }`}
                            >
                              {priority}
                            </span>
                          </td>
                          <td className="px-2 text-center">
                            <span
                              className={`rounded px-1 py-0.5 ${
                                STATUS_BADGE[status] || STATUS_BADGE.in_washing
                              }`}
                            >
                              {STATUS_LABEL[status] || status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card p-3">
            <h3 className="text-xs font-semibold text-gray-900 mb-2 uppercase">
              Accessories ({accessoryGroups.length} categories / {accessoryRows.length} lines)
            </h3>
            {accessoryRows.length === 0 ? (
              <p className="text-gray-500 py-2">No accessories in this job.</p>
            ) : (
              <div className="border border-gray-200 rounded overflow-auto">
                <table className="table w-full text-[11px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-2">
                        <TableHeaderLabel>Category</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Qty</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Returned</TableHeaderLabel>
                      </th>
                      <th className="text-right px-2">
                        <TableHeaderLabel align="right">Rate</TableHeaderLabel>
                      </th>
                      <th className="text-right px-2">
                        <TableHeaderLabel align="right">Line total</TableHeaderLabel>
                      </th>
                      <th className="text-center px-2">
                        <TableHeaderLabel align="center">Status</TableHeaderLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessoryGroups.map((group) => {
                      const expanded = expandedAccessoryCategories.has(group.key);
                      const allReturned = group.rows.every(
                        (row) =>
                          row.status === 'returned' ||
                          Number(row.qtyReturned || 0) >= Number(row.qty || 0)
                      );
                      const allCancelled = group.rows.every((row) => row.status === 'cancelled');
                      const status = allCancelled
                        ? 'cancelled'
                        : allReturned
                          ? 'returned'
                          : 'in_washing';
                      const rates = new Set(group.rows.map((row) => Number(row.rate || 0)));
                      return (
                        <Fragment key={group.key}>
                          <tr className="border-t border-gray-100">
                            <td className="px-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 font-medium hover:text-brand"
                                onClick={() =>
                                  setExpandedAccessoryCategories((current) => {
                                    const next = new Set(current);
                                    if (next.has(group.key)) next.delete(group.key);
                                    else next.add(group.key);
                                    return next;
                                  })
                                }
                                aria-expanded={expanded}
                              >
                                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                {group.label}
                              </button>
                            </td>
                            <td className="px-2 text-center">{group.qty}</td>
                            <td className="px-2 text-center">{group.qtyReturned}</td>
                            <td className="px-2 text-right">
                              {rates.size === 1 ? formatCurrency(group.rows[0]?.rate) : 'Multiple'}
                            </td>
                            <td className="px-2 text-right">{formatCurrency(group.lineTotal)}</td>
                            <td className="px-2 text-center">
                              <span
                                className={`rounded px-1 py-0.5 ${
                                  STATUS_BADGE[status] || STATUS_BADGE.in_washing
                                }`}
                              >
                                {STATUS_LABEL[status] || status}
                              </span>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-t border-gray-100 bg-gray-50">
                              <td colSpan={6} className="px-5 py-2">
                                <div className="space-y-1">
                                  {group.rows.map((row) => (
                                    <div
                                      key={row.rowId}
                                      className="flex items-center justify-between gap-3"
                                    >
                                      <span>{row.name || 'Accessory'}</span>
                                      <span className="tabular-nums text-gray-500">
                                        Qty {Number(row.qty || 0)} · Returned{' '}
                                        {Number(row.qtyReturned || 0)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
};

export default ViewLaundryJobPage;
