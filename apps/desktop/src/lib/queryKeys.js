/** Central TanStack Query keys — prefix-friendly for invalidateQueries. */

export const queryKeys = {
  orders: {
    all: ['orders'],
    list: (params) => ['orders', params],
    detail: (id) => ['order', id],
    edit: (id) => ['order-edit', id],
    settlement: (id) => ['order', 'settlement', id],
    deliverySettlement: (id) => ['order', 'delivery-settlement', id],
    returnSettlement: (id) => ['order', 'return-settlement', id],
    cancelSummary: (id) => ['order', id, 'cancel-summary'],
    transactions: (id) => ['order', id, 'transactions-modal'],
    securityTransactions: (id) => ['order', id, 'security-transactions'],
  },
  itemStages: {
    collectAll: ['items-to-collect'],
    collect: (params) => ['items-to-collect', params],
    prepareAll: ['items-to-prepare'],
    prepare: (params) => ['items-to-prepare', params],
  },
  delivery: {
    all: ['delivery'],
    list: (params) => ['delivery', params],
  },
  return: {
    all: ['return'],
    list: (params) => ['return', params],
  },
  bookedProducts: {
    all: ['booked-products'],
    list: (params) => ['booked-products', params],
  },
  dashboard: {
    all: ['dashboard'],
    bookingsMonth: (key) => ['dashboard-bookings-month', key],
    bookingsTrend: (months) => ['dashboard-bookings-trend', months],
    bookingEarning: (rangeDays) => ['dashboard-booking-earning', rangeDays],
    calendar: (monthParam) => ['dashboard-calendar', monthParam],
  },
  sales: {
    all: ['sales'],
    list: (params) => ['sales', params],
    detail: (id) => ['sale', id],
  },
  products: {
    all: ['products'],
    list: (params) => ['products', params],
    detail: (id) => ['product', id],
  },
  accessories: {
    all: ['accessories'],
    detail: (id) => ['accessory', id],
  },
  customers: {
    all: ['customers'],
    detail: (id) => ['customer', id],
    search: ['customer-search'],
  },
  incomeEntries: {
    all: ['income-entries'],
  },
  expenseEntries: {
    all: ['expense-entries'],
  },
  journalVouchers: {
    all: ['journal-vouchers'],
  },
  paymentVouchers: {
    all: ['payment-vouchers'],
  },
  receiptVouchers: {
    all: ['receipt-vouchers'],
  },
  paymentAccounts: {
    all: ['payment-accounts'],
  },
  appSettings: {
    all: ['app-settings'],
  },
  ipWhitelist: {
    all: ['ip-whitelist'],
  },
  drafts: {
    availabilityCart: ['drafts', 'availability_cart'],
  },
  users: {
    dropdown: ['users', 'dropdown'],
  },
  categories: {
    product: ['categories', 'product'],
    accessory: ['categories', 'accessory'],
  },
  creditNotes: {
    all: ['credit-notes'],
  },
  reports: {
    pendingBills: ['reports', 'pending-bills'],
    incomeExpense: ['reports', 'income-expense'],
  },
};
