import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Select from '../../components/ui/Select.jsx';
import { useOrderReplacementRequirements, useReplaceOrderItem } from '../../hooks/api/useOrderReplacements.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { productsApi } from '../../lib/api/products.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import { syncService } from '../../services/syncService.js';
import { toast } from '../../stores/uiStore.js';

const EMPTY_IDS = [];

export default function ReplacementRequirementsPanel({ orderId, direction = 'target', sourceItemIds = EMPTY_IDS }) {
  const online = useOnlineStatus();
  const query = useOrderReplacementRequirements(orderId, direction, sourceItemIds);
  const mutation = useReplaceOrderItem();
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [queuedItems, setQueuedItems] = useState([]);
  const products = useQuery({
    queryKey: ['products', 'replacement-picker', search],
    queryFn: () => productsApi.list({ search, per_page: 50, catalog_active: 'active' }),
    enabled: Boolean(selected && online),
  });
  const rows = (query.data || []).filter((row) => row.status === 'pending' || row.status === 'preview');
  const available = (products.data?.data || []).filter((product) =>
    product.id !== selected?.current_product_id && product.type !== 'sell'
  );

  const submit = () => {
    if (!selected || !productId || mutation.isPending) return;
    const target = selected;
    mutation.mutate({
      orderId: target.target_order_id,
      itemId: target.target_order_item_id,
      payload: {
        replacement_product_id: productId,
        expected_product_id: target.current_product_id,
        expected_line_version: Number(target.replacement_version || 0),
        idempotency_key: target.request_key,
      },
      metadata: { orderNumber: target.order_number },
    }, {
      onSuccess: (result) => {
        if (result.queued) {
          setQueuedItems((items) => [...items, target.target_order_item_id]);
          toast.warning('Replacement queued. Delivery remains blocked until the server confirms it.');
        } else toast.success('Replacement saved. Prepare the new product before delivery.');
        setSelected(null);
      },
      onError: (error) => {
        toast.error(getApiErrorMessage(error, 'Could not replace product'));
        void query.refetch();
      },
    });
  };

  if (query.isError) return (
    <div role="alert" className="my-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
      Could not load replacement requirements. Check the connection before delivery.
      <Button variant="secondary" size="sm" onClick={() => query.refetch()}>Retry</Button>
    </div>
  );
  if (!rows.length) return null;
  return (
    <section className="my-3 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-gray-900">
      <h3 className="font-semibold">Alternate products required before delivery</h3>
      <p className="mt-1 text-xs">Current return can be saved. Each affected future item must be replaced; repair alone does not release this requirement.</p>
      {!online ? <p className="mt-1 text-xs font-medium">Offline: showing cached requirements. Changes require server confirmation before delivery.</p> : null}
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-surface p-2">
            <div className="min-w-0">
              <Link to={`/booking/${row.target_order_id}`} className="font-medium text-brand underline">{row.order_number || 'Open booking'}</Link>
              <span> · {formatDate(row.pickup_date)} · {row.source_product_label}</span>
              {row.customer_name ? <p className="text-xs text-gray-600">{row.customer_name}</p> : null}
            </div>
            <Button size="sm" variant="secondary"
              disabled={row.status === 'preview' || queuedItems.includes(row.target_order_item_id)}
              onClick={() => { setSelected({ ...row, request_key: syncService.createIdempotencyKey() }); setProductId(''); setSearch(''); }}>
              {row.status === 'preview' ? 'Save return first' : queuedItems.includes(row.target_order_item_id) ? 'Pending sync' : 'Select replacement'}
            </Button>
          </li>
        ))}
      </ul>
      <Modal isOpen={Boolean(selected)} onClose={() => !mutation.isPending && setSelected(null)}
        title="Replace damaged product" size="md" closeOnBackdrop={false}
        footer={<div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={mutation.isPending} onClick={() => setSelected(null)}>Cancel</Button>
          <Button disabled={!productId || mutation.isPending} onClick={submit}>{online ? 'Save replacement' : 'Queue replacement'}</Button>
        </div>}>
        <div className="space-y-3">
          <p className="text-sm">The agreed price and payment history stay unchanged. The new product must be collected and prepared again.</p>
          <Input label="Search product code or name" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Select label="Replacement product" value={productId} placeholder="Choose an alternate product"
            onChange={(event) => setProductId(event.target.value)}
            options={available.map((product) => ({ value: product.id, label: `${product.code || ''} ${product.name}`.trim() }))} />
          {products.isError ? <p className="text-sm text-red-600">Could not load products. Please retry when connected.</p> : null}
          <p className="text-xs text-gray-600">Availability is checked again when the server saves this replacement.</p>
        </div>
      </Modal>
    </section>
  );
}

ReplacementRequirementsPanel.propTypes = {
  orderId: PropTypes.string.isRequired,
  direction: PropTypes.oneOf(['source', 'target']),
  sourceItemIds: PropTypes.arrayOf(PropTypes.string),
};
