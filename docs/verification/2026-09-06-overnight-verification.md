# Overnight verification — 2026-09-06

Base checkout: `6061123`. This is a bounded engineering verification report, not an assertion that the entire original requirement list has passed live acceptance. Nothing was pushed. The previous [acceptance checklist](2026-09-05-acceptance-checklist.md) retains its historical evidence and the complete operator checklist.

Verified implementation commit: `498fd7b` (`fix: harden reporting, catalog safety and outbound workflows`), local only. The final post-suite code adjustment only moved a static import to the top of its file; its six focused tests were rerun successfully. This documentation is committed separately.

## Plan and safety boundaries

1. Review the highest-risk remaining paths: money/status reports, affected quantities, deletion retries, permission loading, WhatsApp selection/session races, and attachments.
2. Reproduce concrete defects with synthetic regressions, implement focused fixes, and obtain independent peer review.
3. Exercise the real services and authenticated routes against a disposable MySQL instance; generate and inspect synthetic PDF pages.
4. Run all workspace tests, production build, bundle/lint/no-TypeScript/whitespace guards, then record a local-only handoff.

Three existing review agents worked on finance, catalog/permissions, and WhatsApp/uploads. Cross-review found additional finance summary and WhatsApp lifecycle defects; those were fixed and added to regression coverage before the final run.

No business database, real account/password, customer message, payment, production migration, installed MySQL service, or live provider session was changed. The native wrapper uses a separate loopback-only MySQL server with fresh temporary data, blank provider configuration, and synthetic users. Authenticated API checks use Fastify injection without starting an HTTP listener or provider workers. Generated PDFs/images and the local PDF-inspection dependency remain under ignored `tmp/`, outside application dependencies.

## Fixes made

### Finance, security, and commissions

- Applied the same search/date/account/transaction predicates to report rows and uncapped aggregate totals. Ascending requests now select the oldest matching rows before branch limits.
- Removed the UI's account-name heuristic for security. Explicit customer `deposit` and `deposit_refund` types are excluded from income/expense rows and totals on the server. Legitimate accountless rent payments remain visible. Explicitly settled condition charges still enter through income entries; purchase/vendor payment handling is unchanged.
- Added typed receipt/payment voucher references and retained linked purchase/washing references. Receipt voucher deep links load one shop-scoped record through a UUID-validated, permission-protected GET route. A delayed link response cannot replace a newer manually opened draft or cross a changed shop/login scope.
- Aligned legacy payment-time status SQL with display logic, including India-local date boundaries and authoritative explicit payment stages.
- Corrected Due Security search totals and partially returned accessory quantities/status.
- Corrected salesman discount allocation after filtering, category eligibility for per-booking commission, reassigned-product booking-owner grouping, and sale unit counts.

### Returns, deletion, and permissions

- Explicit accessory damage/missing quantities must be whole numbers within the line quantity. Invalid zero, over-quantity, negative, fractional, or non-finite values are rejected instead of silently normalized. Legacy absent quantities retain their read fallback.
- Catalog deletion now carries explicit deactivation/permanent intent. Retrying deactivation cannot accidentally hard-delete a now-inactive record. Permanent deletion requires inactive state and checks active bookings/washing under transaction locks; completed history keeps its existing snapshots.
- Bulk product deletion requires inactive items, reports actual deleted counts, and cannot bypass operational-use protection.
- Permission editing is scoped to the loaded shop/role matrix; switching scope, loading failures, or stale grids cannot save permissions against a different scope.

### WhatsApp and purchase attachments

- An empty selected-item list no longer expands into a whole-bill PDF. Delivery messages use committed lines, support partial delivery, and ask separately for the item PDF before the bill notice.
- Preserved accessory category/quantity information, including historical rows without a current catalog identifier.
- Cancelled/competing prompts, unmounted pages, failed PDF generation, and changed shop/login scope cannot silently proceed to sending.
- Strict recipient normalization rejects overlong/invalid values instead of truncating into a different phone number. Login/contact editing behavior was not changed.
- Serialized start/logout operations and persistence, drained pending credential writes before reconnect/auth removal, and rejected stale socket callbacks. Accepted pairing credentials survive a same-tick temporary disconnect. Manual logout invalidates pending send/reconnect work.
- PDF attachments with absent/generic MIME are normalized only after checking the PDF header; invalid files are rejected. Upload cancellation and URL preview detection have focused tests. Stacked thumbnail controls no longer block the underlying zoom target.

### Printing/export

- Large washing groups now continue across bounded code boxes rather than running off the page. Long labels/codes use a full-width wrapping table. The priority heading stays with its first code group, and the totals separator no longer crosses payable text.
- Added repeatable pending-bills and washing PDF fixtures plus regressions for all-page export, filter preservation, later-page failure, and busy-state/error recovery.

## Verification results

| Check | Result | Boundary |
| --- | --- | --- |
| All workspace automated tests | **487 passed, zero failures**: backend 179, desktop 158, shared 150 | Focused automated evidence; not every real workflow |
| Full quiet ESLint | Passed, exit 0 | Existing non-fatal warnings are not a clean-warning claim |
| No-TypeScript guard | Passed | No TypeScript files/dependencies added |
| Desktop production build | Passed; 3,560 modules | Deployment/configuration not exercised |
| Strict bundle guard | Passed; entry 66.5 KB, critical JS/CSS 170.5 KB gzip | Existing mixed static/dynamic `printBill.js` warning remains non-fatal |
| Native isolated MySQL + authenticated route suite | **Passed, exit 0**, 2026-09-06 01:27 IST; database `wrs_test_integrity_1788638192521_a8b3c97c` and temporary server cleaned | Installed service and business data unchanged |
| PDF fixtures | Six report PDFs / 18 rendered pages plus the repeated five-page Prepare fixture inspected; all 600 washing codes, full long code, and 105 pending-bill identifiers present; no out-of-page text blocks | Synthetic files only; no physical printer |
| Git whitespace guard | Passed | Staged content rechecked before commit |
| Live browser / mobile | Not available in this session | No browser was exposed by the computer-use connection; earlier browser evidence is historical only |

The native suite includes existing migration/OTP repair, atomic booking edits, return/security/condition settlement, future-order replacements, reminder lease/retry dispatch with a fake sender, checklist rollback/replay/stale-state handling, and document-number concurrency checks. New fixtures add catalog deletion intent/locking, all 11 report transaction filters, payment-time status, >500-row report/summary cases, commission attribution, and actual phone-login/shop/permission boundaries. Initial runs exposed two synthetic report-fixture mistakes (an excluded row still matched its search token, then its replacement number exceeded the schema width) and a test-writer session timezone mismatch. The writer now enforces UTC like the application pool; explicit stored-instant checks guard that assumption. Fixtures were corrected rather than weakening report assertions.

## Repeat safely

From the repository root:

```powershell
npm --workspaces --if-present test
node node_modules/eslint/bin/eslint.js "apps/**/*.{js,jsx,cjs,mjs}" "packages/**/*.{js,jsx,cjs,mjs}" --quiet
npm run check:no-ts
npm run build:desktop
npm run check:bundle-budget
node apps/backend/scripts/run-native-isolated-integrity.js
node apps/desktop/scripts/generate-report-acceptance-fixtures.mjs
git -c core.safecrlf=false diff --check
```

Do not substitute the ordinary app migration/seed commands for the isolated wrapper. Confirm its successful exit and final cleanup message. PDF outputs are in `tmp/pdfs/2026-09-06/`; `final-contact-sheet.png` is local inspection evidence, not a committed application asset.

## Morning acceptance gates

These gates prevent full rollout sign-off; they are not represented as passing merely because unit tests pass.

1. **Browser/operator:** repeat the existing checklist on a disposable shop at 320/375/390/768 px and desktop. In particular, recheck the sidebar interpretation, permission scope switching while loading, receipt/payment links, PDF download, upload controls, and offline queue/reload/reconnect behavior.
2. **Finance:** compare controlled booking, delivery, return, security-deposit, partial refund, and explicit condition-settlement examples against expected balances. Security-only receipt/refund must not alter income/profit; explicit settlement must. Reopen records after saves.
3. **WhatsApp:** use a consenting test number to verify partial-delivery item PDF then optional bill, missing-item message, time format and day-before eligibility, reconnect/server restart, and manual logout staying logged out. Provider-forced logout cannot be prevented by application code.
4. **Email and cloud storage:** use deliberately configured test SMTP/GCS credentials for admin OTP and image/PDF upload/reopen. No actual provider delivery was attempted overnight.
5. **Printing:** use test paper to verify first-page content, multi-page washing/Prepare output, both phone numbers, and physical up/down inch offsets.
6. **Business decision:** GST-to-rough conversion remains deferred until numbering, tax/audit retention, payment transfer, and conversion-direction rules are explained. No conversion workflow was invented or run.

The original request did not fully specify standalone sale commission policy or how discounts shared between products and accessories should affect commission. Existing policy was preserved; the changes fix filtering/attribution, not an unapproved commission formula.
