import PropTypes from 'prop-types';

import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';

export function buildAccessoryStockSummary(lines, stockById) {
  const map = new Map();
  for (const line of lines || []) {
    if (line.item_type !== 'item' || !line.accessory_id) continue;
    const id = String(line.accessory_id);
    const row = map.get(id) || {
      accessoryId: id,
      name: line.name_snapshot || 'Item',
      purchaseQty: 0,
    };
    row.purchaseQty += Math.max(0, Number(line.qty) || 0);
    if (line.name_snapshot) row.name = line.name_snapshot;
    map.set(id, row);
  }

  return [...map.values()].map((row) => {
    const currentStock = Math.max(0, Number(stockById.get(row.accessoryId)?.qty ?? 0) || 0);
    return {
      ...row,
      currentStock,
      afterStock: currentStock + row.purchaseQty,
    };
  });
}

const PurchaseAccessoryStockConfirmModal = ({
  isOpen,
  onClose,
  summary,
  loading,
  onConfirmAddToStock,
  onConfirmBillOnly,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Accessory stock update"
    size="lg"
    footer={
      <>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={onConfirmBillOnly} disabled={loading || summary.length === 0}>
          Bill only (do not update stock)
        </Button>
        <Button onClick={onConfirmAddToStock} loading={loading} disabled={loading || summary.length === 0}>
          Yes, add to stock
        </Button>
      </>
    }
  >
    <p className="text-sm text-gray-700 mb-3">
      नीचे accessories की CRM stock quantity दी गई है। क्या purchase quantity को stock में add करना है?
      (Product lines हमेशा stock में update होंगी।)
    </p>
    {loading && summary.length === 0 ? (
      <p className="text-sm text-gray-500 py-6 text-center">Loading current stock…</p>
    ) : null}
    <div className="overflow-x-auto border border-gray-200 rounded-md">
      <table className="table w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">
              <TableHeaderLabel>Item</TableHeaderLabel>
            </th>
            <th className="text-right">
              <TableHeaderLabel align="right">Current stock</TableHeaderLabel>
            </th>
            <th className="text-right">
              <TableHeaderLabel align="right">Purchase qty</TableHeaderLabel>
            </th>
            <th className="text-right">
              <TableHeaderLabel align="right">After (if add)</TableHeaderLabel>
            </th>
          </tr>
        </thead>
        <tbody className={loading && summary.length === 0 ? 'hidden' : ''}>
          {summary.map((row) => (
            <tr key={row.accessoryId} className="border-t border-gray-100">
              <td className="px-3 py-2 text-gray-900">{row.name}</td>
              <td className="px-3 py-2 text-right text-gray-700">{row.currentStock}</td>
              <td className="px-3 py-2 text-right font-medium text-brand">{row.purchaseQty}</td>
              <td className="px-3 py-2 text-right text-green-700 font-semibold">{row.afterStock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="mt-3 text-xs text-gray-500">
      Example: current stock 50 + purchase 100 = 150 after you choose &quot;Yes, add to stock&quot;.
    </p>
  </Modal>
);

PurchaseAccessoryStockConfirmModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  summary: PropTypes.arrayOf(
    PropTypes.shape({
      accessoryId: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      currentStock: PropTypes.number.isRequired,
      purchaseQty: PropTypes.number.isRequired,
      afterStock: PropTypes.number.isRequired,
    })
  ).isRequired,
  loading: PropTypes.bool,
  onConfirmAddToStock: PropTypes.func.isRequired,
  onConfirmBillOnly: PropTypes.func.isRequired,
};

export default PurchaseAccessoryStockConfirmModal;
