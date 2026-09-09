# GST invoices and Shop Admin IP policies

Implemented on 8 September 2026. This records the new GST and Shop Admin scope; the earlier general-improvements audit remains separate.

## Available workflows

- **GST Report → Created GST invoices → Create GST bills:** choose Rent or Sale, original-bill From/To dates, bill/customer search and a maximum original amount of 10,000 / 15,000 / 20,000 or a custom amount. Select individual bills across pages and bill types.
- Enter separate Rent and Sale allocation percentages, then override any selected bill. Review descriptions, HSN/SAC, place of supply, recipient GSTIN, actual GST components and documented non-GST remainders before issuing.
- Percentage, tax-rate and amount fields accept typed or pasted decimals. Clearing a field or typing a partial decimal no longer resets or clamps it; review validates the completed values before sending numeric data to the API or offline queue. Missing supplier setup is explained beside the draft and review action, separately from the customer's recipient GSTIN.
- The percentage determines the invoice's GST-inclusive total. A 10,000 original with 20% allocation creates a 2,000 invoice. At a 5% tax rate this is 1,904.76 taxable value plus 95.24 tax. The original total, payment history and security deposit remain recorded against the original bill.
- Each original receives one independently numbered invoice. Rent and Sale share a GSTIN/financial-year counter such as `GST/26-27/00001`, including branches using the same GSTIN. Issuance uses the server's current India date.
- Issued invoices can be opened, printed and downloaded as PDFs. The issued register exports all matching pages. Existing direct GST bills remain under **Existing GST bills**.
- **Settings → IP Whitelisting:** Shop Admin can edit the selected shop's default IP policy and overrides for its members. Super Admin also retains a separate installation-policy view and recovery access.

## Integrity and access

- Issuance validates current source fingerprints and commits a batch atomically. Repeated requests with the same actor, shop, key and payload return the original result. Changed payloads, duplicate originals, invalid allocations and stale sources are rejected.
- Supplier/customer identity, line allocations and tax amounts are stored as issued snapshots. Original billed edits, replacements, discount changes, cancellation and deletion are blocked after issuance. Operational payments, delivery and return use their existing paths. An issued-invoice correction workflow is outside this change.
- New endpoints validate shop membership and require Shop Admin or Super Admin. User-level shop IP exceptions cannot override an installation-level denial. Saving a policy that blocks the acting Shop Admin's current connection is rejected.
- IP policy saves use revision checks and request receipts. Shop switching validates the target shop before selecting it. Restricted sessions retain their validation state across refresh/offline startup.
- Both new writes use the existing durable sync queue. Queued work remains pending, is bound to its actor/shop, and receives an invoice number or effective IP change only after server confirmation. Conflicts remain visible for review.

## Verification

- `npm test --workspaces --if-present`: **515 passing tests** (188 backend, 169 desktop, 158 shared), zero failures.
- Disposable native MySQL run: all transaction and HTTP assertions passed, including the new GST/IP fixture. The final run used `wrs_test_integrity_1788875725712_0c4d6b8b`; its synthetic database and temporary server were removed after shutdown. No business database was changed.
- The reported 8,500 booking scenario was reproduced entirely with synthetic data: two rental lines of 5,000 and 3,500, returned status, and an 8,500 payment through the HTTP endpoint. Missing supplier GSTIN/address correctly rejected preview without creating an invoice. With synthetic supplier setup, 20% allocation at a 5% inclusive tax rate reviewed and issued as 1,700 (taxable value 1,619.05; tax 80.95; non-GST remainder 6,800). Preview created no invoice; issuance and retry preserved the original booking and payment records. The created invoice opened through its detail endpoint.
- Exact bulk scenario: 100 original sale bills of 10,000; select 20 at 20%; assert 20 issued invoices totaling 40,000, 80 remaining eligible bills, and original sales totaling 1,000,000.
- Other database assertions cover simultaneous replay, numbering across shops sharing a GSTIN, atomic rollback on a stale source, source edit locks, unchanged payments/security, amount limits, foreign-shop and non-admin rejection, stale IP revisions, self-lockout prevention and Super Admin recovery.
- HTTP IP checks also saved a staff override, verified allowed and denied addresses, reset it to inherit, and verified the inherited shop policy took effect.
- Offline tests cover reload persistence, exact payload reuse, user/shop isolation and failed IP revision review. Shared calculations cover inclusive tax, paise rounding, invalid allocations and financial-year boundaries.
- Production Vite build passed. Strict bundle check: entry gzip **67.2 KB**, critical JS/CSS **171.2 KB**.
- ESLint completed with **zero errors**; repository warnings remain. The no-TypeScript guard and `git diff --check` passed.
- Generated and rendered one-page and seven-page synthetic GST PDFs; visually inspected all eight pages. Verified repeated headers, complete rows, readable totals and page numbering. User-provided text is escaped in print HTML. Non-ASCII document downloads use the existing HTML-to-PDF path.
- No browser/app surfaces were available to the computer-use tool. Interactive browser/mobile acceptance, non-ASCII browser PDF rendering and physical-printer output have not been verified.

Local test logs and synthetic renderings are in ignored `tmp/gst-ip-*.log` and `tmp/pdfs/`.

## Rollout

Nothing was committed, pushed or deployed during this verification. The boss's shop GSTIN, addresses, bookings and IP settings were not changed. The configured local database had already listed the new migration as applied during an earlier read-only status check; this verification used only the disposable database above.

The deployment script now runs migrations from the newly built image before replacing the running backend. If migration fails, `set -e` stops deployment before `up -d`. Verify migration status on the actual destination using the project's normal deployment steps: auth/IP checks and source edit guards require `apps/backend/src/db/migrations/20261016140000_gst_invoices_and_shop_ip_policies.js`.

The current checkout is on `master`. The existing GitHub workflow deploys automatically on a push to `main` (and supports manual dispatch); no workflow was triggered in this review.

The migration preserves existing bills and policies. Its automatic down migration intentionally refuses to drop issued records; use a reviewed restore or forward migration if recovery is needed. Configure the shop's GSTIN and supplier/customer addresses before issuing invoices.
