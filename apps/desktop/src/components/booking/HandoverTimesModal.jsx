import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getIndiaDateTimeParts, nowDatetimeLocal } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';

import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';
import { ordersApi } from '../../lib/api/orders.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';

function instantToIndiaLocal(value) {
  if (!value) return '';
  const p = getIndiaDateTimeParts(value);
  return p ? `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` : '';
}

function indiaLocalToIso(value) {
  if (!value) return null;
  const ms = Date.parse(`${value}:00+05:30`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function HandoverTimesModal({ order = null, onClose }) {
  const queryClient = useQueryClient();
  const [delivered, setDelivered] = useState('');
  const [returned, setReturned] = useState('');

  useEffect(() => {
    if (!order) return;
    setDelivered(instantToIndiaLocal(order.delivered_at));
    setReturned(instantToIndiaLocal(order.returned_at));
  }, [order]);

  const mutation = useMutation({
    mutationFn: () =>
      ordersApi.setHandoverTimes(order.id, {
        delivered_at: indiaLocalToIso(delivered),
        returned_at: indiaLocalToIso(returned),
      }),
    onSuccess: async () => {
      toast.success('Delivery / return time updated');
      await invalidateOrderDomain(queryClient, { orderId: order.id });
      onClose();
    },
    onError: (e) => {
      toast.error(e?.response?.data?.error?.message || e?.message || 'Failed to update');
    },
  });

  const invalidRange = Boolean(delivered && returned && returned < delivered);

  return (
    <Modal
      isOpen={Boolean(order)}
      onClose={onClose}
      size="sm"
      title={`Delivery / Return time${order?.order_number ? ` — ${order.order_number}` : ''}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={invalidRange || mutation.isPending}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <Input
            id="handover-delivered-at"
            label="Delivery date & time"
            type="datetime-local"
            className="flex-1"
            value={delivered}
            onChange={(e) => setDelivered(e.target.value)}
          />
          <Button variant="ghost" size="sm" onClick={() => setDelivered(nowDatetimeLocal())}>
            Now
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDelivered('')}>
            Clear
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Input
            id="handover-returned-at"
            label="Return date & time"
            type="datetime-local"
            className="flex-1"
            value={returned}
            min={delivered || undefined}
            error={invalidRange ? 'Return cannot be before delivery' : undefined}
            onChange={(e) => setReturned(e.target.value)}
          />
          <Button variant="ghost" size="sm" onClick={() => setReturned(nowDatetimeLocal())}>
            Now
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setReturned('')}>
            Clear
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          Filled automatically when the order is marked Delivered / Received. Edit here to correct it.
        </p>
      </div>
    </Modal>
  );
}

HandoverTimesModal.propTypes = {
  order: PropTypes.shape({
    id: PropTypes.string.isRequired,
    order_number: PropTypes.string,
    delivered_at: PropTypes.string,
    returned_at: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
};

export default HandoverTimesModal;
