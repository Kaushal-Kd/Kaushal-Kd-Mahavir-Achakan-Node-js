import { useQuery } from '@tanstack/react-query';
import { formatDate, todayIndiaISODate } from '@wrs/shared';
import { Download, FileText } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PreviewableUploadThumb from '../../components/ui/PreviewableUploadThumb.jsx';
import { purchasesApi } from '../../lib/api/purchases.js';
import { isPdfAttachmentUrl } from '../../services/uploadAttachment.js';
import { toast } from '../../stores/uiStore.js';
import { flattenPurchaseAttachments } from '../../utils/purchaseAttachments.js';

const EXPORT_PER_PAGE = 500;

async function fetchPurchasesForDates(dateFrom, dateTo, vendorAccountId) {
  const acc = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await purchasesApi.list({
      from: dateFrom || undefined,
      to: dateTo || undefined,
      vendor_account_id: vendorAccountId || undefined,
      page,
      per_page: EXPORT_PER_PAGE,
      sort: '-p.purchase_date',
    });
    acc.push(...(res?.data || []));
    totalPages = Number(res?.meta?.total_pages) || 1;
    page += 1;
  } while (page <= totalPages);
  return acc;
}

const PurchaseImagesPdfModal = ({
  isOpen,
  onClose,
  initialDateFrom = '',
  initialDateTo = '',
  vendorAccountId = '',
}) => {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [downloadBusy, setDownloadBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const today = todayIndiaISODate();
    const nextTo = initialDateTo || today;
    setDateFrom(initialDateFrom || nextTo);
    setDateTo(nextTo);
    setSelectedKeys(new Set());
  }, [isOpen, initialDateFrom, initialDateTo]);

  const listQuery = useQuery({
    queryKey: ['purchases', 'images-pdf', dateFrom, dateTo, vendorAccountId],
    queryFn: () => fetchPurchasesForDates(dateFrom, dateTo, vendorAccountId),
    enabled: Boolean(isOpen && dateFrom && dateTo),
  });

  const items = useMemo(
    () => flattenPurchaseAttachments(listQuery.data || []),
    [listQuery.data]
  );

  useEffect(() => {
    const valid = new Set(items.map((item) => item.key));
    setSelectedKeys((prev) => {
      const next = new Set([...prev].filter((key) => valid.has(key)));
      if (next.size === prev.size && [...next].every((key) => prev.has(key))) return prev;
      return next;
    });
  }, [items]);

  const selectedCount = selectedKeys.size;
  const allSelected = items.length > 0 && items.every((item) => selectedKeys.has(item.key));

  const toggleKey = (key, checked) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const downloadPdf = async () => {
    if (!dateFrom || !dateTo) {
      toast.warning('Fill the date range first');
      return;
    }
    const selected = items.filter((item) => selectedKeys.has(item.key));
    if (!selected.length) {
      toast.warning('Select at least one image');
      return;
    }
    setDownloadBusy(true);
    try {
      const { buildSelectedPurchaseImagesPdfDoc } = await import(
        '../../utils/purchaseCombinedPdf.js'
      );
      const subtitle = `Date ${formatDate(dateFrom) || dateFrom} to ${formatDate(dateTo) || dateTo}`;
      const doc = await buildSelectedPurchaseImagesPdfDoc(selected, {
        title: 'Purchase images',
        subtitle,
      });
      doc.save(`purchase_images_${dateFrom}_${dateTo}.pdf`);
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error(err?.message || 'Could not download PDF');
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title="Download purchase images PDF"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={downloadBusy}>
            Close
          </Button>
          <Button
            type="button"
            icon={Download}
            loading={downloadBusy}
            disabled={!selectedCount}
            onClick={downloadPdf}
          >
            Download PDF ({selectedCount})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Fill the purchase date, tick the uploaded bill photos you need, then download them
          together as one PDF.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-gray-500">From date</span>
            <input
              type="date"
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <span className="pb-2 text-xs text-gray-400">to</span>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-gray-500">To date</span>
            <input
              type="date"
              className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!items.length}
            onClick={() =>
              setSelectedKeys(allSelected ? new Set() : new Set(items.map((item) => item.key)))
            }
          >
            {allSelected ? 'Clear selection' : 'Select all'}
          </Button>
        </div>

        {listQuery.isLoading ? (
          <p className="py-6 text-sm text-gray-500">Loading bill images…</p>
        ) : listQuery.isError ? (
          <p className="py-6 text-sm text-red-600">Could not load purchase images.</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-sm text-gray-500">
            No bill images for this date. Attach photos on a purchase, then try again.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((item) => {
              const pdf = isPdfAttachmentUrl(item.url);
              const checked = selectedKeys.has(item.key);
              const bill = item.purchase?.purchase_number || 'Purchase';
              const dateText = formatDate(item.purchase?.purchase_date) || '';
              return (
                <div
                  key={item.key}
                  className={`overflow-hidden rounded-lg border bg-white ${
                    checked ? 'border-brand ring-1 ring-brand' : 'border-gray-200'
                  }`}
                >
                  <div className="relative h-28 w-full bg-gray-50">
                    {pdf ? (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-gray-500">
                        <FileText className="h-8 w-8 text-brand" />
                        <span className="text-[10px] font-medium">PDF bill</span>
                      </div>
                    ) : (
                      <PreviewableUploadThumb
                        src={item.url}
                        alt={`${bill} attachment`}
                        className="h-28 w-full object-cover"
                      />
                    )}
                    <input
                      type="checkbox"
                      className="absolute left-2 top-2 z-20 h-4 w-4 accent-brand"
                      checked={checked}
                      onChange={(e) => toggleKey(item.key, e.target.checked)}
                      aria-label={`Select ${bill} attachment ${item.index + 1}`}
                    />
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-xs font-medium text-gray-800">{bill}</p>
                    <p className="text-[10px] text-gray-500">{dateText || '—'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};

PurchaseImagesPdfModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  initialDateFrom: PropTypes.string,
  initialDateTo: PropTypes.string,
  vendorAccountId: PropTypes.string,
};

export default PurchaseImagesPdfModal;
