import PropTypes from 'prop-types';

import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

function tokenChoiceVariant(printed) {
  return printed ? 'primary' : 'ghost';
}

function tokenChoiceClassName(printed) {
  return printed ? '' : 'bg-gray-200 text-gray-500 hover:bg-gray-300';
}

const PrintTokenTypeModal = ({
  isOpen,
  onClose,
  onChooseProduct,
  onChooseAllProducts,
  onChooseAccessories,
  onChooseBoth,
  onChooseBill,
  loading = false,
  orderLabel = '',
  mode = 'print',
  showProduct = true,
  showAccessories = true,
  showBoth = false,
  showBill = false,
  requireExplicitClose = false,
  productPrinted = false,
  accessoryPrinted = false,
}) => {
  const isDownload = mode === 'download';
  const title = isDownload ? 'Download tokens' : showBill ? 'Print documents' : 'Print token';
  const prompt = isDownload
    ? 'What do you want to download?'
    : showBill
      ? 'What would you like to print?'
      : 'What do you want to print?';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      closeOnBackdrop={!requireExplicitClose}
      closeOnEscape={!requireExplicitClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          {showProduct ? (
            <Button
              variant={tokenChoiceVariant(productPrinted)}
              className={tokenChoiceClassName(productPrinted)}
              onClick={onChooseProduct}
              loading={loading}
            >
              Product-wise
            </Button>
          ) : null}
          {showProduct && onChooseAllProducts ? (
            <Button
              variant={tokenChoiceVariant(productPrinted)}
              className={tokenChoiceClassName(productPrinted)}
              onClick={onChooseAllProducts}
              loading={loading}
            >
              All Products
            </Button>
          ) : null}
          {showAccessories ? (
            <Button
              variant={tokenChoiceVariant(accessoryPrinted)}
              className={tokenChoiceClassName(accessoryPrinted)}
              onClick={onChooseAccessories}
              loading={loading}
            >
              Accessories
            </Button>
          ) : null}
          {showBoth && onChooseBoth ? (
            <Button variant="primary" onClick={onChooseBoth} loading={loading}>
              Both
            </Button>
          ) : null}
          {showBill && onChooseBill ? (
            <Button variant="primary" onClick={onChooseBill} loading={loading}>
              Bill
            </Button>
          ) : null}
        </>
      }
    >
      <p className="text-sm text-gray-700">
        {prompt}
        {orderLabel ? (
          <>
            {' '}
            <span className="font-mono text-gray-900">{orderLabel}</span>
          </>
        ) : null}
      </p>
      {!showProduct && !showAccessories && !showBoth && !showBill ? (
        <p className="mt-2 text-sm text-gray-500">
          This booking has no product lines or pack-with-rent accessories for token slips.
        </p>
      ) : null}
    </Modal>
  );
};

PrintTokenTypeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onChooseProduct: PropTypes.func.isRequired,
  onChooseAllProducts: PropTypes.func,
  onChooseAccessories: PropTypes.func.isRequired,
  onChooseBoth: PropTypes.func,
  onChooseBill: PropTypes.func,
  loading: PropTypes.bool,
  orderLabel: PropTypes.string,
  mode: PropTypes.oneOf(['print', 'download']),
  showProduct: PropTypes.bool,
  showAccessories: PropTypes.bool,
  showBoth: PropTypes.bool,
  showBill: PropTypes.bool,
  requireExplicitClose: PropTypes.bool,
  productPrinted: PropTypes.bool,
  accessoryPrinted: PropTypes.bool,
};

export default PrintTokenTypeModal;
