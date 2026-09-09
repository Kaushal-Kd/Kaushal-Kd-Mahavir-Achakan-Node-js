import { api, unwrap } from '../api.js';

export const reportsApi = {
  sales: (params) => api.get('/reports/sales', { params }).then(unwrap),
  rental: (params) => api.get('/reports/rental', { params }).then(unwrap),
  payments: (params) => api.get('/reports/payments', { params }).then(unwrap),
  dues: (params) => api.get('/reports/dues', { params }).then(unwrap),
  inventory: () => api.get('/reports/inventory').then(unwrap),
  productHistory: (params) => api.get('/reports/product-history', { params }).then(unwrap),
  salesman: (params) => api.get('/reports/salesman', { params }).then(unwrap),
  productPerformance: (params) => api.get('/reports/product-performance', { params }).then(unwrap),
  pendingBills: (params) => api.get('/reports/pending-bills', { params }).then(unwrap),
  incomeExpense: (params) => api.get('/reports/income-expense', { params }).then(unwrap),
  accountLedger: (params) => api.get('/reports/account-ledger', { params }).then(unwrap),
  trialBalance: (params) => api.get('/reports/trial-balance', { params }).then(unwrap),
  dailyCashbook: (params) => api.get('/reports/daily-cashbook', { params }).then(unwrap),
  dailyCashbookLines: (params) => api.get('/reports/daily-cashbook/lines', { params }).then(unwrap),
  cashReconciliations: (params) => api.get('/reports/daily-cashbook/reconciliations', { params }).then(unwrap),
  closeCashCounter: (payload) => api.post('/reports/daily-cashbook/reconciliations', payload).then(unwrap),
};
