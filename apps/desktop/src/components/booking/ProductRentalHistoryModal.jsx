import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { productsApi } from '../../lib/api/products.js';
import Modal from '../ui/Modal.jsx';
import ProductHistoryTable from './ProductHistoryTable.jsx';
import ProductSaleHistoryTable from './ProductSaleHistoryTable.jsx';

const ProductRentalHistoryModal = ({
  isOpen,
  onClose,
  product,
  windowFrom = '',
  windowTo = '',
}) => {
  const navigate = useNavigate();
  const [showAllRentals, setShowAllRentals] = useState(false);
  const [showAllSales, setShowAllSales] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setShowAllRentals(false);
    setShowAllSales(false);
  }, [isOpen, product?.id]);

  const productStatus = String(product?.status || '').toLowerCase();
  const hasDateWindow = Boolean(String(windowFrom || '').trim() && String(windowTo || '').trim());

  const rentalHistoryQuery = useQuery({
    queryKey: ['product-rental-history', product?.id, showAllRentals],
    queryFn: () =>
      productsApi.rentalHistory(product.id, {
        show_all: showAllRentals,
      }),
    enabled: isOpen && !!product?.id,
    placeholderData: (previousData) => previousData,
  });

  const saleHistoryParams = showAllSales
    ? { show_all: true }
    : {
        show_all: false,
        ...(hasDateWindow ? { from: windowFrom, to: windowTo } : {}),
      };

  const saleHistoryQuery = useQuery({
    queryKey: [
      'product-sale-history',
      product?.id,
      showAllSales,
      hasDateWindow ? windowFrom : '',
      hasDateWindow ? windowTo : '',
    ],
    queryFn: () => productsApi.saleHistory(product.id, saleHistoryParams),
    enabled: isOpen && !!product?.id,
    placeholderData: (previousData) => previousData,
  });

  const rentalRows = rentalHistoryQuery.data?.data?.rows ?? [];
  const saleRows = saleHistoryQuery.data?.data?.rows ?? [];
  const showSaleSection = productStatus === 'sold' || saleRows.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title="Product History">
      {product ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 border-b border-gray-200 pb-3">
            <span className="min-w-0">
              Code:{' '}
              <span className="font-mono text-gray-900">
                {product.code}
                {product.size ? ` [${product.size}]` : ''}
              </span>
              {product.color ? <span className="text-gray-600"> · {product.color}</span> : null}
            </span>
            <span>
              Qty:{' '}
              <span className="font-medium text-gray-900">
                {Number(product.total_qty ?? product.qty ?? 0)}
              </span>
            </span>
            <span className="min-w-0">
              Name: <span className="font-medium text-gray-900 break-words">{product.name}</span>
            </span>
            {productStatus ? (
              <span className="capitalize">
                Status: <span className="font-medium text-gray-900">{productStatus}</span>
              </span>
            ) : null}
          </div>

          {showSaleSection ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Sale history</h3>
                  {!showAllSales && hasDateWindow ? (
                    <p className="text-xs text-gray-500">
                      Filtered to {formatDate(windowFrom)} – {formatDate(windowTo)}
                    </p>
                  ) : null}
                </div>
                <label
                  htmlFor="product-sale-history-show-all"
                  className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer shrink-0"
                >
                  <input
                    id="product-sale-history-show-all"
                    type="checkbox"
                    checked={showAllSales}
                    onChange={(e) => setShowAllSales(e.target.checked)}
                    className="rounded border-gray-300 text-brand focus:ring-brand"
                  />
                  Show all sales
                </label>
              </div>
              <ProductSaleHistoryTable
                rows={saleRows}
                loading={saleHistoryQuery.isFetching}
                fetchError={
                  saleHistoryQuery.isError
                    ? saleHistoryQuery.error?.message || 'Could not load sale history'
                    : null
                }
                onEditSale={(saleId) => {
                  onClose();
                  navigate(`/sales/${saleId}/edit`);
                }}
                onEditBooking={(orderId) => {
                  onClose();
                  navigate(`/booking/${orderId}/edit`);
                }}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Rental history</h3>
              <label
                htmlFor="product-rental-history-show-all"
                className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer shrink-0"
              >
                <input
                  id="product-rental-history-show-all"
                  type="checkbox"
                  checked={showAllRentals}
                  onChange={(e) => setShowAllRentals(e.target.checked)}
                  className="rounded border-gray-300 text-brand focus:ring-brand"
                />
                Show all rentals
              </label>
            </div>
            <ProductHistoryTable
              rows={rentalRows}
              loading={rentalHistoryQuery.isFetching}
              fetchError={
                rentalHistoryQuery.isError
                  ? rentalHistoryQuery.error?.message || 'Could not load history'
                  : null
              }
              onEdit={(orderId) => {
                onClose();
                navigate(`/booking/${orderId}/edit`);
              }}
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
};

ProductRentalHistoryModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  product: PropTypes.shape({
    id: PropTypes.string.isRequired,
    code: PropTypes.string,
    name: PropTypes.string,
    size: PropTypes.string,
    color: PropTypes.string,
    qty: PropTypes.number,
    total_qty: PropTypes.number,
    status: PropTypes.string,
  }),
  windowFrom: PropTypes.string,
  windowTo: PropTypes.string,
};

ProductRentalHistoryModal.defaultProps = {
  product: null,
  windowFrom: '',
  windowTo: '',
};

export default ProductRentalHistoryModal;
