import fs from 'fs';

const path = 'apps/desktop/src/pages/purchases/CreatePurchase.jsx';
let s = fs.readFileSync(path, 'utf8');

const reps = [
  ['CreateSale', 'CreatePurchase'],
  ['saleId', 'purchaseId'],
  ['salesApi', 'purchasesApi'],
  ['saleDate', 'purchaseDate'],
  ['saleType', 'lineType'],
  ['saleQuery', 'purchaseQuery'],
  ["['sale',", "['purchase',"],
  ["'/sales'", "'/purchases'"],
  ['Sale updated', 'Purchase updated'],
  ['Sale created', 'Purchase created'],
  ['save sale', 'save purchase'],
  ['Create Sale', 'Create Purchase'],
  ['Edit Sale', 'Edit Purchase'],
  ["label: 'Sales'", "label: 'Purchases'"],
  ['sale_date', 'purchase_date'],
  ['sale_number', 'purchase_number'],
  ['Item Sale', 'Item Purchase'],
  ['Product Sale', 'Product Purchase'],
  ['sale-search', 'purchase-search'],
  ['getSaleAvailableQty', 'getPurchaseAvailableQty'],
  ['catalogSellPrice', 'catalogPurchasePrice'],
  ['isSellableProduct', 'isCatalogProduct'],
  ['isSellableAccessory', 'isCatalogAccessory'],
  ['saleAccessoryIds', 'purchaseAccessoryIds'],
  ['saleType ===', 'lineType ==='],
  ['name="saleType"', 'name="lineType"'],
];

for (const [a, b] of reps) s = s.split(a).join(b);

s = s.replace(/import \{ buildSalesmanSelectOptions \} from '[^']+';\n/, '');
s = s.replace(/import \{ usersApi \} from '[^']+';\n/, '');
s = s.replace(/import \{ useAuthStore \} from '[^']+';\n/, '');
s = s.replace(/  const currentUser = useAuthStore\(\(s\) => s\.user\);\n/, '');
s = s.replace(/, sale_only: true/, '');

s = s.replace(
  /function isCatalogProduct\(row\) \{[\s\S]*?\}\n\n/,
  'function isCatalogProduct() {\n  return true;\n}\n\n'
);
s = s.replace(
  /function isCatalogAccessory\(row\) \{[\s\S]*?\}\n\n/,
  'function isCatalogAccessory() {\n  return true;\n}\n\n'
);
s = s.replace(/function getPurchaseAvailableQty\([\s\S]*?\n\}/, 'function getPurchaseAvailableQty() {\n  return 999999;\n}');

s = s.replace(
  /function catalogPurchasePrice\(catalog\) \{[\s\S]*?\}/,
  `function catalogPurchasePrice(catalog) {
  if (!catalog) return 0;
  const pp = Number(catalog?.purchase_price);
  if (Number.isFinite(pp) && pp > 0) return pp;
  return Number(catalog?.price ?? 0) || 0;
}`
);

fs.writeFileSync(path, s);
console.log('transformed', path);
