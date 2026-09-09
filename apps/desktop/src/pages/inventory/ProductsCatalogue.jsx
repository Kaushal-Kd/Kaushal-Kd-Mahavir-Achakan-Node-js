import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import ProductCatalogueCard from '../../components/catalog/ProductCatalogueCard.jsx';
import Button from '../../components/ui/Button.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableListFooter from '../../components/ui/TableListFooter.jsx';
import { categoriesApi } from '../../lib/api/categories.js';
import { productsApi } from '../../lib/api/products.js';
import { tableCountFromListResponse } from '../../lib/tableListMeta.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';

const ProductsCatalogue = () => {
  const [searchInput, setSearchInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [noImageOnly, setNoImageOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [uploadingId, setUploadingId] = useState(null);

  const buildAppliedFilters = useCallback(
    () => ({
      search: searchInput.trim() || undefined,
      category_id: categoryId || undefined,
      no_image: noImageOnly ? '1' : undefined,
    }),
    [searchInput, categoryId, noImageOnly]
  );

  const [appliedFilters, setAppliedFilters] = useState(() => ({
    search: undefined,
    category_id: undefined,
    no_image: undefined,
  }));

  const filterKey = useMemo(() => JSON.stringify(appliedFilters), [appliedFilters]);

  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const { data: cats } = useQuery({
    queryKey: ['categories', 'product', 'products-catalogue'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const categoryOptions = useMemo(() => {
    const rows = cats?.data ?? cats ?? [];
    const list = Array.isArray(rows) ? rows : [];
    return [
      { value: '', label: 'All' },
      ...list.map((c) => ({ value: c.id, label: c.label || c.id })),
    ];
  }, [cats]);

  const { data: listData, isLoading, isFetching } = useQuery({
    queryKey: ['products-catalogue', appliedFilters, page, perPage],
    queryFn: () =>
      productsApi.list({
        page,
        per_page: perPage,
        catalog_active: 'active',
        ...(appliedFilters.search ? { search: appliedFilters.search } : {}),
        ...(appliedFilters.category_id ? { category_id: appliedFilters.category_id } : {}),
        ...(appliedFilters.no_image ? { no_image: appliedFilters.no_image } : {}),
      }),
    keepPreviousData: true,
  });

  const rows = listData?.data ?? [];
  const tableMeta = tableCountFromListResponse(listData, 'products');
  const showEmpty = !isLoading && rows.length === 0;

  const runSearch = () => {
    setPage(1);
    setAppliedFilters(buildAppliedFilters());
  };

  return (
    <div>
      <PageHeader
        title="Products Catalogue"
        breadcrumbs={[
          { label: 'Dashboard', to: '/' },
          { label: 'Products Catalogue', to: null },
        ]}
      />

      <div className="card p-1.5 mb-3 flex items-center gap-x-2 gap-y-1 text-[11px] overflow-x-auto">
        <span className="text-gray-500 font-medium shrink-0">Filters</span>
        <label className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500 shrink-0">
            Category<span className="text-red-500">*</span>
          </span>
          <select
            className="border border-gray-200 rounded px-1.5 py-0.5 h-7 bg-white text-[11px] max-w-[9rem]"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categoryOptions.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 shrink-0 min-w-[10rem] flex-1 max-w-[14rem]">
          <Search size={14} className="text-gray-400 shrink-0" aria-hidden />
          <input
            type="search"
            className="flex-1 min-w-0 outline-none text-[11px] bg-transparent border border-gray-200 rounded px-2 py-0.5 h-7"
            placeholder="Search Code.."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
          />
        </label>
        <label className="flex items-center gap-1 shrink-0 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-brand focus:ring-brand"
            checked={noImageOnly}
            onChange={(e) => setNoImageOnly(e.target.checked)}
          />
          <span className="text-gray-700">No Image</span>
        </label>
        <Button
          variant="primary"
          size="sm"
          icon={Search}
          className="h-7 shrink-0 px-2.5 text-[11px] whitespace-nowrap ml-auto"
          onClick={runSearch}
          loading={isFetching && !!appliedFilters}
        >
          Search
        </Button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : showEmpty ? (
          <div className="p-8 text-center text-sm text-gray-600">No products found.</div>
        ) : (
          <div className="px-3 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {rows.map((product) => (
              <ProductCatalogueCard
                key={product.id}
                product={product}
                uploading={uploadingId === product.id}
                onUploadStart={setUploadingId}
                onUploadEnd={() => setUploadingId(null)}
              />
            ))}
          </div>
        )}
        <TableListFooter
          visibleCount={tableMeta.visibleCount}
          totalCount={tableMeta.totalCount}
          page={tableMeta.page}
          totalPages={tableMeta.totalPages}
          countLabel={tableMeta.countLabel}
          loading={isFetching}
          onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setPage((p) => p + 1)}
          disablePrevious={tableMeta.page <= 1}
          disableNext={tableMeta.page >= tableMeta.totalPages}
          className="rounded-b-lg shrink-0"
          perPage={perPage}
          onPerPageChange={(n) => {
            setPage(1);
            setPerPage(n);
          }}
        />
      </div>
    </div>
  );
};

export default ProductsCatalogue;
