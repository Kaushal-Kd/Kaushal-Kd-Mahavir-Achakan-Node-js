# patches CancelSummaryModal form section
path = "apps/desktop/src/pages/booking/CancelSummaryModal.jsx"
with open(path, encoding="utf-8") as f:
    s = f.read()

marker_start = '          <form className="space-y-3 text-[11px] leading-snug" onSubmit={submit}>'
marker_end = "          </form>"

i0 = s.find(marker_start)
i1 = s.find(marker_end, i0)
if i0 < 0 or i1 < 0:
    raise SystemExit("markers not found")

form = r'''          <form className="space-y-3 text-[11px] leading-snug" onSubmit={submit}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="min-w-0">
                <label className="block text-[10px] font-medium text-gray-600 mb-1">Bill Amount</label>
                <input
                  readOnly
                  value={formatCurrency(order.total_amount)}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
                />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0 mb-0.5">
                  <span className="text-[10px] font-medium text-gray-600">Total Discount:</span>
                  <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                    {formatCurrency(order.discount_total)}
                  </span>
                </div>
                <input
                  readOnly
                  value={String(Number(order.discount_total || 0))}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-white tabular-nums"
                />
              </div>
              <div className="min-w-0">
                <motionlessToolbar />
              </motionlessToolbar>
            </motionlessToolbar>
          </form>'''

# Replace placeholder tags - use unique token PLACEHOLDER_SECURITY_BLOCK
form = form.replace("<motionlessToolbar />", "PLACEHOLDER_SECURITY")
form = form.replace("</motionlessToolbar>", "ENDPLACEHOLDER")
form = form.replace("ENDPLACEHOLDER", "")

security_block = r'''                <motionlessToolbar />
              </motionlessToolbar>'''

security_block = r'''                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1 mb-0.5">
                  <span className="text-[10px] font-medium text-gray-600">Security Amt.:</span>
                  {securityRefundNum > 0 ? (
                    <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                      {formatCurrency(securityRemainingAfterEntry)}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                      {formatCurrency(securityHeldNow)}
                    </span>
                  )}
                  {singleSecurityTxInline ? (
                    <span
                      className="text-[10px] font-medium text-gray-800 tabular-nums truncate min-w-0 max-w-[11rem] sm:max-w-[15rem]"
                      title={singleSecurityTxInline}
                    >
                      {singleSecurityTxInline}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex text-gray-500 shrink-0 cursor-pointer rounded p-0.5 hover:bg-gray-100"
                    title="Security transactions"
                    aria-label="Security transactions"
                    onClick={() => setSecurityTxOpen(true)}
                  >
                    <Info size={12} aria-hidden />
                  </button>
                </div>
                <div className="flex gap-1 items-center">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={maxSecurityRefundNow}
                    value={securityRefundAmount}
                    onChange={(e) =>
                      setSecurityRefundAmount(
                        e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                      )
                    }
                    className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] tabular-nums"
                    title={`Max ${formatCurrency(maxSecurityRefundNow)}`}
                  />
                  {securityAccounts.length > 0 ? (
                    <select
                      className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] bg-surface pr-5"
                      value={securityAccountId}
                      onChange={(e) => setSecurityAccountId(e.target.value)}
                    >
                      {securityOptions.map((o) => (
                        <option key={o.value === '' ? '_empty' : o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[10px] text-gray-500">No accounts</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="min-w-0">
                <label className="block text-[10px] font-medium text-gray-600 mb-1">Advance</label>
                <input
                  readOnly
                  value={formatCurrency(advanceNetPaid)}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-[10px] font-medium text-gray-600 mb-1">Refund</label>
                <div className="flex gap-1 items-center">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={maxRefundNow}
                    value={refundAmount}
                    onChange={(e) =>
                      setRefundAmount(
                        e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                      )
                    }
                    className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] tabular-nums"
                    title={`Max ${formatCurrency(maxRefundNow)}`}
                  />
                  {hasLedgerBankCash ? (
                    <select
                      className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] bg-surface pr-5"
                      value={refundPaymentAccountId}
                      onChange={(e) => setRefundPaymentAccountId(e.target.value)}
                    >
                      <option value="">Select account</option>
                      {settlementBankAccounts.length ? (
                        <optgroup label="Bank">
                          {settlementBankAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {settlementCashAccounts.length ? (
                        <optgroup label="Cash">
                          {settlementCashAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                  ) : (
                    <span className="text-[10px] text-gray-500">No accounts</span>
                  )}
                </div>
                {advanceNetPaid > 0 ? (
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Credit note (auto): {formatCurrency(autoCreditNoteNum)}
                    {autoCreditNoteNum > 0 ? ` · ${CREDIT_NOTE_REMARKS}` : ''}
                  </p>
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="flex flex-row gap-1 items-baseline justify-between">
                  <label className="block text-[10px] font-medium text-gray-600 mb-1">Total Payble Amount</label>
                  <span
                    className={`text-[10px] font-semibold tabular-nums ${
                      pendingAfterRefundPreview > 0 ? 'text-red-600' : 'text-gray-500'
                    }`}
                  >
                    Pending Amount: {formatCurrency(pendingAfterRefundPreview)}
                  </span>
                </div>
                <input
                  readOnly
                  value={formatCurrency(order.balance || 0)}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
                />
              </div>
            </div>
          </form>'''

form = form.replace("PLACEHOLDER_SECURITY", security_block.split("motionlessToolbar")[0] if "motionlessToolbar" in security_block else security_block)
# security_block was written without motionless - use it directly
form = r'''          <form className="space-y-3 text-[11px] leading-snug" onSubmit={submit}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="min-w-0">
                <label className="block text-[10px] font-medium text-gray-600 mb-1">Bill Amount</label>
                <input
                  readOnly
                  value={formatCurrency(order.total_amount)}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
                />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0 mb-0.5">
                  <span className="text-[10px] font-medium text-gray-600">Total Discount:</span>
                  <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                    {formatCurrency(order.discount_total)}
                  </span>
                </motionlessToolbar>
              </motionlessToolbar>
            </motionlessToolbar>
          </form>'''

print("ERROR: script needs manual fix")
exit(1)
