import {
  calculateGstAllocation,
  formatCurrency,
  gstInvoiceIssueSchema,
  todayIndiaISODate,
} from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useRef, useState } from 'react';
import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import SaleBillLink from '../../components/booking/SaleBillLink.jsx';
import Button from '../../components/ui/Button.jsx';
import Checkbox from '../../components/ui/Checkbox.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import { useGstBills, useIssueGstInvoices } from '../../hooks/api/useGstInvoices.js';
import { useAppSettings } from '../../hooks/useAppSettings.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { gstApi } from '../../lib/api/gst.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import {
  applyGstDraftPercentage,
  createGstInvoiceDraft,
  getGstSourceIssues,
  normalizeGstInvoiceInput,
  readGstDecimal,
  readGstPercentage,
} from '../../lib/gstInvoiceDraft.js';
import { downloadIssuedGstPdf, printIssuedGstInvoice } from '../../lib/gstInvoiceDocument.js';
import { runTablePdfExport } from '../../lib/reportPdfExport.js';
import { syncService } from '../../services/syncService.js';
import { toast } from '../../stores/uiStore.js';

function GstAllocationCard({ draft, onChange, onRemove }) {
  const { source, input } = draft;
  const [hsn, setHsn] = useState('');
  const [rate, setRate] = useState('');
  const patch = (value) => onChange({ ...draft, input: { ...input, ...value } });
  const patchLine = (index, value) =>
    patch({
      components: input.components.map((line, i) => (i === index ? { ...line, ...value } : line)),
    });
  let summary;
  let error;
  let target;
  const sourceIssues = getGstSourceIssues(source);
  try {
    target = Math.round(source.total_amount * readGstPercentage(input.percentage)) / 100;
    summary = calculateGstAllocation(source, normalizeGstInvoiceInput(input));
  } catch (e) {
    error = e.message;
  }
  return (
    <section className="card space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>
          {source.source_type === 'sale' ? 'Sale' : 'Rent'} {source.source_number} ·{' '}
          {source.customer_name} · {formatCurrency(source.total_amount)}
        </strong>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {sourceIssues.length > 0 && (
        <div
          role="alert"
          className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-gray-800"
        >
          {sourceIssues.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          label="GST allocation % (tax included)"
          type="text"
          inputMode="decimal"
          value={input.percentage}
          onChange={(e) => onChange(applyGstDraftPercentage(draft, e.target.value))}
        />
        <Input
          label="Recipient GSTIN (if registered)"
          maxLength={15}
          value={input.recipient_gstin}
          onChange={(e) => patch({ recipient_gstin: e.target.value.toUpperCase() })}
        />
        <Input
          label="Place of supply: state code"
          maxLength={2}
          value={input.place_of_supply}
          onChange={(e) => patch({ place_of_supply: e.target.value })}
        />
      </div>
      <p className="text-xs text-gray-600">
        GST total target:{' '}
        {target === undefined ? 'Enter an allocation percentage' : formatCurrency(target)}. Review
        actual GST components and describe the non-GST remainder. Changing the allocation percentage
        redistributes line amounts.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-36">
          <Input
            label="Apply HSN/SAC"
            maxLength={8}
            value={hsn}
            onChange={(e) => setHsn(e.target.value)}
          />
        </div>
        <div className="w-36">
          <Input
            label="Apply GST tax rate %"
            type="text"
            inputMode="decimal"
            hint="Type a rate, e.g. 5 or 0.5"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            let taxRate;
            try {
              if (rate.trim()) taxRate = readGstPercentage(rate, 'GST tax rate %');
            } catch (e) {
              toast.error(e.message);
              return;
            }
            patch({
              components: input.components.map((line) => ({
                ...line,
                ...(hsn ? { hsn_sac: hsn } : {}),
                ...(taxRate !== undefined ? { tax_rate: taxRate } : {}),
              })),
            });
          }}
        >
          Apply to components
        </Button>
      </div>
      <div className="space-y-3">
        {input.components.map((line, index) => (
          <div className="rounded border border-gray-200 p-3" key={line.line_key}>
            <p className="mb-2 text-xs font-semibold">
              {source.lines[index].name} · source qty {source.lines[index].qty} · component{' '}
              {formatCurrency(source.lines[index].gross_amount)}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                label="GST component description"
                value={line.description}
                maxLength={500}
                onChange={(e) => patchLine(index, { description: e.target.value })}
              />
              <Input
                label="HSN / SAC"
                maxLength={8}
                value={line.hsn_sac}
                onChange={(e) => patchLine(index, { hsn_sac: e.target.value })}
              />
              <Input
                label="GST portion incl. tax"
                type="text"
                inputMode="decimal"
                value={line.gst_gross}
                onChange={(e) => patchLine(index, { gst_gross: e.target.value })}
              />
              <Input
                label="GST tax rate %"
                type="text"
                inputMode="decimal"
                value={line.tax_rate}
                onChange={(e) => patchLine(index, { tax_rate: e.target.value })}
              />
            </div>
            {source.lines[index].gross_amount > line.gst_gross && (
              <Input
                className="mt-2"
                label={`Non-GST components / reason (${formatCurrency(source.lines[index].gross_amount - line.gst_gross)})`}
                required
                maxLength={1000}
                value={line.non_gst_reason}
                onChange={(e) => patchLine(index, { non_gst_reason: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <p className="text-sm text-brand">
          Taxable {formatCurrency(summary.taxable_value)} + tax {formatCurrency(summary.tax_total)}{' '}
          = GST invoice {formatCurrency(summary.grand_total)} · Non-GST{' '}
          {formatCurrency(summary.non_gst_amount)}
        </p>
      )}
    </section>
  );
}
GstAllocationCard.propTypes = {
  draft: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

export default function GstInvoiceWorkspace() {
  const online = useOnlineStatus();
  const { gst } = useAppSettings();
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useState({
    source: 'booking',
    from: `${todayIndiaISODate().slice(0, 7)}-01`,
    to: todayIndiaISODate(),
    search: '',
    page: 1,
    per_page: 50,
  });
  const [limit, setLimit] = useState('10000');
  const [customLimit, setCustomLimit] = useState('20000');
  const maxAmount = Number(limit === 'custom' ? customLimit : limit);
  const [defaults, setDefaults] = useState({ booking: '', sale: '' });
  const [selected, setSelected] = useState({});
  const [review, setReview] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [document, setDocument] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  const selecting = useRef(new Set());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(
    () =>
      syncService.subscribe((state) =>
        setPending(state.entries.some((e) => e.entity === 'gst_issuance'))
      ),
    []
  );
  const queryParams = { ...params, ...(creating ? { max_amount: maxAmount || 10000 } : {}) };
  const query = useGstBills(queryParams, creating);
  const payload = query.data?.data;
  const errorToast = (error) =>
    toast.error(getApiErrorMessage(error, 'Could not complete GST action'));
  const issuer = useIssueGstInvoices({
    onSuccess: (result) => {
      if (!alive.current) return;
      setReview(null);
      setSelected({});
      toast.success(
        result.queued
          ? 'Saved locally. Pending sync; no GST invoice number has been issued yet.'
          : `${result.response.data.invoices.length} GST invoice(s) issued`
      );
      if (!result.queued) {
        setCreating(false);
        setParams((p) => ({
          ...p,
          from: `${todayIndiaISODate().slice(0, 7)}-01`,
          to: todayIndiaISODate(),
          page: 1,
        }));
      }
    },
    onError: errorToast,
  });
  const drafts = Object.values(selected);
  const filter = (patch) => {
    setReviewError('');
    setParams((p) => ({ ...p, ...patch, page: 1 }));
    if ('from' in patch || 'to' in patch) {
      setSelected({});
      selecting.current.clear();
    }
  };
  const choose = async (row, checked) => {
    setReviewError('');
    const key = `${row.source_type}:${row.id}`;
    if (!checked) {
      selecting.current.delete(key);
      setSelected((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
      return;
    }
    let percentage;
    try {
      percentage = readGstPercentage(
        defaults[row.source_type],
        `${row.source_type === 'sale' ? 'Sale' : 'Rent'} allocation %`
      );
    } catch (e) {
      toast.error(e.message);
      return;
    }
    selecting.current.add(key);
    setBusy(true);
    try {
      const response = await gstApi.candidate(row.source_type, row.id);
      if (!alive.current || !selecting.current.has(key)) return;
      setSelected((s) => ({
        ...s,
        [key]: createGstInvoiceDraft(response.data, percentage, gst.cgst + gst.sgst),
      }));
    } catch (error) {
      errorToast(error);
    } finally {
      selecting.current.delete(key);
      if (alive.current) setBusy(false);
    }
  };
  const prepareReview = async () => {
    setReviewError('');
    setBusy(true);
    try {
      for (const draft of drafts) {
        const issues = getGstSourceIssues(draft.source);
        if (issues.length) throw new Error(`${draft.source.source_number}: ${issues.join(' ')}`);
      }
      const body = gstInvoiceIssueSchema.safeParse({
        idempotency_key: syncService.createIdempotencyKey(),
        max_amount: readGstDecimal(
          limit === 'custom' ? customLimit : limit,
          'Maximum original bill amount'
        ),
        invoices: drafts.map((d) => normalizeGstInvoiceInput(d.input)),
      });
      if (!body.success) throw new Error(body.error.issues[0].message);
      const local = drafts.map((d, index) => {
        if (d.source.total_amount > maxAmount)
          throw new Error('A selected bill exceeds the amount limit');
        return { ...d.source, ...calculateGstAllocation(d.source, body.data.invoices[index]) };
      });
      const response = online ? await gstApi.preview(body.data) : { data: { invoices: local } };
      if (alive.current) setReview({ body: body.data, invoices: response.data.invoices });
    } catch (error) {
      if (alive.current) setReviewError(getApiErrorMessage(error, 'Could not review GST invoices'));
      errorToast(error);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const openInvoice = async (id) => {
    setBusy(true);
    try {
      const result = await gstApi.invoice(id);
      if (alive.current) setDocument(result.data);
    } catch (error) {
      errorToast(error);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const output = async (print) => {
    setBusy(true);
    try {
      await (print ? printIssuedGstInvoice(document) : downloadIssuedGstPdf(document));
    } catch (error) {
      errorToast(error);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const exportRegister = async () => {
    setBusy(true);
    try {
      const rows = [];
      let page = 1;
      let pages = 1;
      do {
        const result = await gstApi.invoices({ ...params, page, per_page: 100 });
        if (!alive.current) return;
        rows.push(...result.data.rows);
        pages = result.data.meta.total_pages;
        page += 1;
      } while (page <= pages);
      await runTablePdfExport({
        filename: `gst-invoices-${params.from}-${params.to}.pdf`,
        title: 'Issued GST invoices',
        subtitle: `${params.from} to ${params.to}`,
        rows,
        columns: [
          'invoice_number',
          'source_number',
          'customer_name',
          'taxable_value',
          'cgst',
          'sgst',
          'igst',
          'grand_total',
        ].map((key) => ({
          key,
          header: key.replaceAll('_', ' '),
          get: (r) =>
            ['taxable_value', 'cgst', 'sgst', 'igst', 'grand_total'].includes(key)
              ? formatCurrency(r[key])
              : r[key],
        })),
      });
    } catch (error) {
      errorToast(error);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const columns = creating
    ? [
        {
          key: 'select',
          header: 'Select',
          render: (row) => (
            <Checkbox
              label={`Select ${row.source_number}`}
              checked={Boolean(selected[`${row.source_type}:${row.id}`])}
              disabled={busy || pending || !online}
              onChange={(checked) => choose(row, checked)}
            />
          ),
        },
        { key: 'source_number', header: 'Original bill' },
        { key: 'customer_name', header: 'Customer' },
        {
          key: 'total_amount',
          header: 'Original amount',
          render: (r) => formatCurrency(r.total_amount),
        },
      ]
    : [
        {
          key: 'invoice_number',
          header: 'GST invoice',
          render: (r) => (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => openInvoice(r.id)}>
              {r.invoice_number}
            </Button>
          ),
        },
        {
          key: 'source_number',
          header: 'Original bill',
          render: (r) =>
            r.source_type === 'sale' ? (
              <SaleBillLink saleId={r.source_id}>{r.source_number}</SaleBillLink>
            ) : (
              <BookingBillLink orderId={r.source_id}>{r.source_number}</BookingBillLink>
            ),
        },
        {
          key: 'invoice_date',
          header: 'Issued',
          render: (r) => String(r.invoice_date).slice(0, 10),
        },
        { key: 'customer_name', header: 'Customer' },
        ...['taxable_value', 'tax_total', 'grand_total'].map((key) => ({
          key,
          header: key.replaceAll('_', ' '),
          render: (r) => formatCurrency(r[key]),
        })),
      ];
  return (
    <>
      <PageHeader
        title={creating ? 'Create GST Bills' : 'Issued GST Invoices'}
        description="Separately numbered invoices linked to original bills. Source billing and payments remain fully recorded."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(!creating);
                setParams((p) => ({ ...p, page: 1 }));
              }}
            >
              {creating ? 'View issued invoices' : 'Create GST bills'}
            </Button>
            {!creating && (
              <Button disabled={busy || !online} onClick={exportRegister}>
                Export register PDF
              </Button>
            )}
          </div>
        }
      />
      <div className="card mb-3 grid grid-cols-2 gap-2 p-3 lg:grid-cols-4">
        <Input
          label={creating ? 'Original bill: From' : 'Invoice issued: From'}
          type="date"
          value={params.from}
          onChange={(e) => filter({ from: e.target.value })}
        />
        <Input
          label="To"
          type="date"
          value={params.to}
          onChange={(e) => filter({ to: e.target.value })}
        />
        <Select
          label="Bill type"
          value={params.source}
          options={[
            { value: 'booking', label: 'Rent' },
            { value: 'sale', label: 'Sale' },
          ]}
          onChange={(e) => filter({ source: e.target.value })}
        />
        <Input
          label="Search bill / customer"
          value={params.search}
          onChange={(e) => filter({ search: e.target.value })}
        />
      </div>
      {creating && (
        <div className="card mb-3 grid grid-cols-1 gap-2 p-3 sm:grid-cols-4">
          <Select
            label="Maximum original bill amount"
            value={limit}
            options={[
              { value: '10000', label: 'Up to ₹10,000' },
              { value: '15000', label: 'Up to ₹15,000' },
              { value: '20000', label: 'Up to ₹20,000' },
              { value: 'custom', label: 'Custom limit' },
            ]}
            onChange={(e) => {
              setLimit(e.target.value);
              setParams((p) => ({ ...p, page: 1 }));
            }}
          />
          {limit === 'custom' && (
            <Input
              label="Custom maximum amount"
              type="text"
              inputMode="decimal"
              value={customLimit}
              onChange={(e) => setCustomLimit(e.target.value)}
            />
          )}
          {['booking', 'sale'].map((type) => (
            <Input
              key={type}
              label={`${type === 'booking' ? 'Rent' : 'Sale'} allocation % for new selections`}
              type="text"
              inputMode="decimal"
              value={defaults[type]}
              onChange={(e) => setDefaults((d) => ({ ...d, [type]: e.target.value }))}
            />
          ))}
        </div>
      )}
      {pending && (
        <p className="mb-3 rounded border border-brand p-3 text-sm text-brand">
          A GST issuance request is pending sync or review. No new invoice numbers are available
          until server confirmation.
        </p>
      )}
      {query.isError && (
        <p role="alert" className="mb-3 text-red-700">
          {getApiErrorMessage(query.error, 'Could not load GST bills')}{' '}
          <Button variant="secondary" onClick={() => query.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {!creating && payload?.summary && (
        <p className="mb-3 text-sm">
          Total taxable: {formatCurrency(payload.summary.taxable_value)} · GST:{' '}
          {formatCurrency(payload.summary.tax_total)} · Invoice total:{' '}
          {formatCurrency(payload.summary.grand_total)}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={payload?.rows || []}
        loading={query.isLoading}
        page={params.page}
        totalPages={payload?.meta?.total_pages || 1}
        totalCount={payload?.meta?.total || 0}
        onPreviousPage={() => setParams((p) => ({ ...p, page: p.page - 1 }))}
        onNextPage={() => setParams((p) => ({ ...p, page: p.page + 1 }))}
        disablePrevious={params.page <= 1}
        disableNext={params.page >= (payload?.meta?.total_pages || 1)}
      />
      {creating && (
        <>
          <div className="sticky top-0 z-10 my-3 flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-white p-3">
            <strong>{drafts.length} bill(s) selected</strong>
            <Button
              disabled={!drafts.length || busy || pending}
              loading={busy}
              onClick={prepareReview}
            >
              {online ? 'Review GST invoices' : 'Review for offline queue'}
            </Button>
          </div>
          {reviewError && (
            <p role="alert" className="mb-3 text-sm text-red-700">
              {reviewError}
            </p>
          )}
          <div className="space-y-4">
            {Object.entries(selected).map(([key, draft]) => (
              <GstAllocationCard
                key={key}
                draft={draft}
                onChange={(value) => {
                  setReviewError('');
                  setSelected((s) => ({ ...s, [key]: value }));
                }}
                onRemove={() =>
                  setSelected((s) => {
                    const next = { ...s };
                    delete next[key];
                    return next;
                  })
                }
              />
            ))}
          </div>
        </>
      )}
      <Modal
        isOpen={Boolean(review)}
        onClose={() => !issuer.isPending && setReview(null)}
        title="Confirm GST invoice issuance"
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <Button variant="secondary" disabled={issuer.isPending} onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button
              loading={issuer.isPending}
              disabled={pending}
              onClick={() => issuer.mutate(review.body)}
            >
              {online ? 'Issue GST invoices' : 'Save to sync queue'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm">
          Review the allocations below. Issuance locks billed details on the original bills.
          Payments and operational delivery/return remain available. Invoice date is the server’s
          actual issuance date.
        </p>
        {(review?.invoices || []).map((r) => (
          <div
            key={`${r.source_type}:${r.source_id}`}
            className="mb-2 rounded border border-gray-200 p-3 text-sm"
          >
            <strong>{r.source_number}</strong> · {r.percentage}% · GST invoice{' '}
            {formatCurrency(r.grand_total)} · included tax {formatCurrency(r.tax_total)} · non-GST{' '}
            {formatCurrency(r.non_gst_amount)}
          </div>
        ))}
      </Modal>
      <Modal
        isOpen={Boolean(document)}
        onClose={() => setDocument(null)}
        title={document?.invoice_number || 'GST invoice'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => output(true)}>
              Print
            </Button>
            <Button disabled={busy} loading={busy} onClick={() => output(false)}>
              Download PDF
            </Button>
          </>
        }
      >
        {document && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{document.supplier.name}</strong>
              <br />
              GSTIN: {document.supplier.gstin}
            </p>
            <p>
              Bill to: {document.customer_name}
              <br />
              {document.customer_address}
              <br />
              Original bill: {document.source_number}
              <br />
              Issued: {document.invoice_date}
            </p>
            <DataTable
              columns={[
                { key: 'description', header: 'GST component' },
                { key: 'hsn_sac', header: 'HSN/SAC' },
                {
                  key: 'gst_gross',
                  header: 'Including GST',
                  render: (r) => formatCurrency(r.gst_gross),
                },
              ]}
              rows={document.lines
                .filter((r) => r.gst_gross > 0)
                .map((r) => ({ ...r, id: r.line_key }))}
            />
            <p>
              Taxable {formatCurrency(document.taxable_value)} · CGST{' '}
              {formatCurrency(document.cgst)} · SGST {formatCurrency(document.sgst)} · IGST{' '}
              {formatCurrency(document.igst)}
            </p>
            <strong>Total: {formatCurrency(document.grand_total)}</strong>
            <p>Payments remain tracked against original bill {document.source_number}.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
GstInvoiceWorkspace.propTypes = {};
