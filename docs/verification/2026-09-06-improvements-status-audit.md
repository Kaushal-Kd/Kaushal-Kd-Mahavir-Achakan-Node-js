# Original improvements list: current status audit

Reviewed on 2026-09-06 against checkout `0ce99f6`. **Most requested behavior has implementation in this checkout, but the entire list is not ready for a blanket “done” sign-off.** GST conversion still needs the user's workflow explanation. Provider, browser/device, printing, and deployment acceptance remain separate checks.

This audit inspected current source, reran automated checks, and used a disposable native MySQL instance. Application code was unchanged. No business database, real login mode, SMTP credentials, customer messages, passwords, or deployment was changed.

## Verification performed in this audit

| Check | Current result |
| --- | --- |
| Workspace automated tests | **498 passed; zero failed or skipped**: backend 185, desktop 160, shared 153. |
| Isolated MySQL integration | **Passed, exit 0.** Fresh/populated migration fixtures, atomic booking edits, delivery/return/checklist replay and concurrency, affected quantities, held-money refunds/settlement, future replacements, catalog deletion, finance/status/commission reports, authentication/permissions, and fake-provider reminder/SMTP checks passed. Temporary database and server cleanup completed. |
| Desktop production build | **Passed, exit 0**, after the required outside-sandbox retry. The first attempt failed because esbuild was denied directory access, before loading the Vite configuration. |
| Strict bundle budget | **Passed**: entry 66.8 KB; critical JS/CSS 170.7 KB gzip. |
| Full quiet ESLint | **Passed, exit 0.** This does not claim all existing warnings are eliminated. |
| No-TypeScript and whitespace checks | **Passed.** |
| Current browser/mobile acceptance | **Unavailable:** the connected computer-use inventory returned no browsers or apps. |
| Real SMTP, WhatsApp, cloud uploads, physical printer | **Not exercised.** Fake-provider tests do not establish actual delivery, persistence, or paper alignment. |
| Fresh PDF visual inspection | **Not repeated in this audit.** Earlier synthetic PDF inspection is recorded in the linked overnight report. |

Local test logs are under ignored `tmp/current-improvements-*.log`. The native run completed at approximately 17:40 IST and removed its disposable `wrs_test_integrity_1788696508801_61e0cd0b` database. The build retains the existing non-fatal mixed static/dynamic `printBill.js` import warning.

## General improvements and Master

“Code present” below means the relevant implementation was located and reviewed. It is not an assertion that every device, record, or operator scenario passed live acceptance.

| Requested behavior | Status and evidence |
| --- | --- |
| Mobile screen cutoff | Responsive layout, viewport-height modal limits, internal scrolling, and compact filter wrapping are present in `components/layout/Layout.jsx`, `components/ui/Modal.jsx`, and `components/list/CompactCatalogFilters.jsx`. Full mobile/keyboard acceptance remains pending. The separate React Native package is still a Phase 2 placeholder; these changes concern the responsive web interface. |
| Three-dot sidebar control and icons when collapsed | Code present in `components/layout/Sidebar.jsx` and `SidebarIconRail.jsx`; focused sidebar tests pass. |
| Hide current month, last month, and total earnings separately | Independent persisted visibility fields are present in `pages/Dashboard.jsx`. Earlier connected acceptance passed; no fresh UI run here. |
| Image sizes in KB; improve quality around 500–700 KB | KB messaging and a 700 KB upload ceiling are present. `utils/compressImage.js` uses a 1920 px maximum edge and initial quality 0.88. This is a target/ceiling, not a guarantee that every image is at least 500 KB; already-small images are not enlarged. Real photo quality/upload/reopen remains pending. |
| Phone + password; explain email | Phone login and email-purpose hints are present. **Phone-only is a rollout setting:** backend defaults to `dual_transition`, which still accepts legacy email login, until explicitly changed after identity readiness checks. The real shop's setting was not inspected or changed. |
| Super Admin user permissions; Shop Admin role permissions | User override and shop role-matrix code is present in `pages/settings/tabs/UsersTab.jsx`, `PermissionsTab.jsx`, and backend user/role routes. Authentication/shop/permission integration checks passed. |
| Every menu permission visible; sticky heading and no cutoff | Shared `components/permissions/PermissionMatrix.jsx` combines module and menu targets and has a sticky heading/first column. Modal/grid scrolling is present; live scroll and permission switching acceptance remain pending. |
| Admin password change via email OTP | Implemented and tested with a fake SMTP sender. **Deployment configuration and real email receipt remain pending**, including the shop-email migration, server encryption key, and per-shop SMTP settings. |
| Low-accessory icon only lights for actual low stock | `LowStockAccessoriesCard` checks loaded low-stock rows before applying alert styling; stock-metric tests pass. |
| Accessory/category A–Z, code/name filter, last-code hint | Backend alphabetical ordering, `search_by`, and `AccessoryCodeHint.jsx` are present; code-hint tests pass. |
| Delete first deactivates; inactive delete is permanent, for products and accessories | Explicit delete intent, inactive-state enforcement, and operational-use protection are implemented in backend `lib/catalogDelete.js`. Retry/booking/washing integration checks passed. Permanent removal can be rejected for items still in use. |
| Reminder Assignee meaning | Hint explicitly explains the person responsible, with “Miraj bhai” as the example. |
| Remove Clear All in Size/Color | `SimpleListEditor.jsx` disables the action for both types. |
| Bill vertical inch placement and editable blank-paper printing | Controls are present in `BillTemplatesTab.jsx`; template tests pass. **Physical printer alignment remains pending.** |
| Compact submenu/filter rows | Compact shared controls are present; narrow screens can wrap to keep controls reachable. A single row at every width is not guaranteed. |
| Movable popups | Shared Modal supports dragging on screens at least 640 px wide. Smaller screens use scrolling/full-height sizing; mobile dragging is not implemented. |
| Remarks renamed Design Details; searchable in Products/Available; hidden from cards | Form/list labels and backend product-notes search are present. The catalogue card does not render design notes. Product-search tests pass. |

Desktop paths in these tables are relative to `apps/desktop/src`; backend paths are relative to `apps/backend/src` unless stated otherwise.

## Transactions

| Requested behavior | Status and evidence |
| --- | --- |
| GST sale percentage calculation | `pages/sales/CreateSale.jsx` applies configured CGST/SGST when GST is selected and recalculates line totals. A live save/reopen/print with the shop's configured rates remains an acceptance check. |
| Sale bill number like booking number | `SaleBillLink.jsx` and `BookingBillLink.jsx` use the same default presentation. Visual approval remains pending. |
| Purchase PDF attachments; vertically stacked zoom/delete | Purchase enables PDF uploads; `MultiImageUploader.jsx` stacks visible controls. Attachment validation/cancellation tests pass; cloud upload and reopen remain pending. |
| Exclude non-washable accessories | Washing eligibility, category filtering, and return/washing transaction logic are present; automated/native checks passed. |
| Washing category summary with names on expansion | Category grouping/detail UI is present in `pages/laundry/CreateLaundryJob.jsx`. |
| Old washing pending amount and final pending total | Vendor outstanding summary/print calculation is present; focused outstanding tests pass. |
| Queued At date and time | Queue UI calls `formatWallClockDateTime(item.queued_at)`. |
| Washing first-page and pagination layout | Pagination/grouping fixes are present in `laundrySlipPrint.js`; earlier synthetic multipage PDFs passed inspection. Current physical print acceptance remains pending. |
| Payment and receipt bill references open their documents | Typed bill/voucher links and scoped receipt lookup are implemented. Link/reference and authenticated route tests pass; fresh click-through acceptance remains pending. |
| Accounts popup closes only through Cancel/intentional Save | Both account modals disable backdrop, Escape, and close-icon dismissal. |
| Sequential payment vouchers | Transactional shop-scoped sequence allocation is implemented; numbering and native concurrency checks pass. |

## Prepare, Delivery, Return, and security

| Requested behavior | Status and evidence |
| --- | --- |
| Correct design detail; product-specific note in a separate box | `lib/itemToPreparePdfExport.js` separates catalog `product_catalog_notes` from line `tailor_notes`, including continuation rows. Focused export tests pass; earlier synthetic PDFs were visually inspected. |
| Primary and WhatsApp numbers stacked in one PDF box | Prepare export collects the two customer numbers; focused export tests pass. |
| Accessory-only bills in Prepare | Explicit accessory-only rows are supported by the report/export paths and fixtures. |
| Transfer one salesman's work to another | Implemented through **Item to Collect → select work rows → Transfer salesman**. Backend reassignment and offline queue/replay tests pass. There is no separate transfer button on the Prepare page. |
| Block collection when configured security is zero | UI/server security-cap checks are present; delivery/native transaction checks pass. Set/save the allowed security amount first. |
| Accessory quantity confirmation on delivery | Count/checklist handling is present; quantity and settlement tests pass. Live popup acceptance remains pending. |
| Save booking edits with mixed delivered/washing dates | Atomic edit/version and line-stage preservation logic is present; native mixed-lifecycle/replay/stale-state checks pass. |
| Incorrect product-unavailable popup | Availability window, overlap/self-exclusion, and item-stage guards are implemented and tested. The original intermittent real-record case still needs operator reproduction if it recurs. |
| Damaged but physically returned product shows Returned | Physical receipt is separated from condition; return/washing tests pass. |
| Damaged product's three future orders require alternates | Replacement obligations and delivery gates exist. Native checks explicitly cover three future bookings, replacement, replay, and stale edits. |
| Damage automatically selects line | Return condition-draft handling and focused tests are present. |
| Only affected accessory quantity is damaged/missing | Explicit quantities are validated; partial condition/washing/replay checks pass. |
| Hold security through washing | Condition-deposit retention, later refund/release, and explicit income settlement are implemented. Washing completion alone does not settle the hold as income. |
| From–To in Booked Product, Security Transactions, Due Security | Date-range controls and server predicates are present; native security range/status fixtures pass. |
| Due Security reflects actual return status | Physical lifecycle/partial quantity logic is present and covered by tests. |
| Missing/Damage remark only shows chosen condition | Condition-specific labels/filters are present in the charge report. |
| Missing-money refund and deposit versus income flow | Assessment, collection/retention, refund, and income settlement are separate ledger actions. **Only explicit settlement recognizes held money as income.** Native money/concurrency/reconciliation checks pass; real balances still require operator reconciliation before rollout. Existing settled historical money is not automatically rewritten. |
| List missing items without charges collected | Missing condition plus **Not collected** filter is implemented, including partial uncollected balances. |
| Booking-wise/product-wise salesman commission | Shop-specific salesman basis/rate controls are present under **Users → Edit → Commission**; report attribution tests pass. These are rates per booking/product quantity; arbitrary per-bill overrides or a new standalone-sale policy are not established by this request. |
| Customers heading | The page heading is **Customers**. The supplied “Customers section header” note specifies no further change to verify. |

## Finance, GST, and WhatsApp

| Requested behavior | Status and evidence |
| --- | --- |
| Pending Bills Amounts name, Advance Amount, working PDF | Label/column and all-filtered-pages export are implemented. Export tests pass; earlier synthetic PDF inspection passed. Current browser download acceptance remains pending. |
| Income/Expense status reflects payment time | Stored event-time status and legacy date/stage handling are implemented. Native report fixtures pass. |
| Voucher reference in income; clickable expense bill numbers | Typed references and linked document destinations are implemented; report/link tests pass. |
| Transaction Type filter | Server row and summary predicates are aligned. Native fixtures cover all 11 transaction filters and combined filters. |
| GST Sales source | Sales tab/report source and bill links are present. |
| Where GST bills appear | GST rental bookings continue through Prepare, Today Delivery, and Today Return by rental stage. GST sales appear under the Sales source; tax mode does not create a rental return lifecycle for a sale. |
| GST → rough conversion | **PENDING USER WORKFLOW.** The page already exposes “Convert to Kaccha” (`pages/reports/GstReport.jsx:108`). Existing backend code changes the current bill's tax mode, removes tax, keeps payments, rejects overpaid conversions, and records a conversion audit. This must not be mistaken for agreement with the user's requested conversion. The user was pinged during this audit; no conversion was exercised or altered. |
| Delivered products/accessories PDF first, bill notice second | `lib/deliveryWhatsAppFlow.js` uses committed newly delivered lines and prompts for their PDF first; bill notice follows when eligible. Focused flow tests pass. |
| Partial delivery sends a list even while In Preparation | Delivered-line selection is independent of whole-order completion; focused tests pass. |
| Accessory category in delivery PDF | Transaction-row/PDF mapping preserves category and quantity, including historical accessory data. Focused tests pass. |
| Return missing-item details and no automatic income settlement | Missing-line flow and held-money ledger are separate. Focused flow and native money tests pass. |
| WhatsApp stays connected until manual logout | Credential persistence, reconnect, and serialized logout safeguards are implemented/tested. **Live restart/reconnect remains pending; provider-forced logout cannot be prevented by this application.** |
| Day-before reminder only for In Preparation | Eligibility is restricted to tomorrow's pickup and `in_preparation`; durable reminder/retry/lease tests pass with a fake sender. |
| Strict automatic time format | Time input/shared validation use 24-hour `HH:mm`; schema and scheduler tests pass. |

## Remaining sign-off work

1. Explain and agree GST conversion: same/new bill, numbering, original record and tax/audit retention, payment handling, and direction. The existing conversion control is already visible, even though this decision remains open.
2. Verify deployment migrations/configuration and whether the real system has switched from transitional to phone-only login. Complete the shop email setup and an actual OTP inbox check using the [email settings handoff](2026-09-06-shop-email-settings.md).
3. Complete the [browser/operator checklist](2026-09-05-acceptance-checklist.md), especially mobile cutoff/keyboard, permission scrolling, voucher links, offline save/reload/reconnect, and representative money balances.
4. Verify real cloud image/PDF uploads and reopen, and actual WhatsApp delivery/partial delivery/missing-return/reminder/restart/logout behavior with an intentionally chosen test recipient.
5. Print representative washing, Prepare, and manually positioned bills on the actual printer and paper.

Prior synthetic PDF and regression evidence: [overnight verification](2026-09-06-overnight-verification.md). It remains historical evidence, not a fresh provider/device acceptance result.
