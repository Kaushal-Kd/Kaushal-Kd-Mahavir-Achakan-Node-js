# Shop-wise email settings — implementation and rollout

## Implemented behavior

Open **Settings → Shops / Branches → Email Settings**. The panel names the currently selected shop. It does not edit whichever row happens to be open in the shop table.

- Super Admin can read/edit SMTP configuration and send configuration-test emails. Shop Admin sees readiness only; other roles cannot access this API.
- Each shop has its own SMTP host, TLS port, username, sender address, and encrypted password. There is no global SMTP fallback or automatic credential import.
- Saving does not send an email. A test is sent only to the signed-in Super Admin's registered email, at most once per shop per minute. A successful response means **accepted by the SMTP server**, not proven inbox delivery.
- A blank password retains the existing secret. A replacement is encrypted with a fresh nonce. Reads, audit records, and form hydration never return the password/ciphertext.
- Only public SMTP hosts and TLS on 465 or required STARTTLS on 587 are supported. The server pins a validated DNS address and verifies its certificate against the configured hostname. Local/private/metadata addresses, plaintext SMTP, OAuth, and custom ports are outside this implementation.
- Settings use revision checks. Stale saves conflict instead of overwriting a newer configuration. A test finishing after credentials are replaced cannot mark the replacement as tested.
- Email configuration is online-only. SMTP passwords never enter the desktop sync queue, persisted stores, or TanStack mutation cache. Shop/login changes invalidate requests and authentication-refresh retries; changing the shop remounts and clears the form.
- Admin password OTPs use the selected authorized shop's sender and the target administrator's registered recipient address. Super Admin changing a Shop Admin password requires that target's membership in the selected shop. Super Admin self-service can use the selected active shop because only Super Admin controls its credentials.
- Existing current-password checks, ten-minute expiry, one-minute request cooldown, five-attempt lockout, one-use confirmation and session revocation remain. A failed send removes its unsent challenge. Existing challenge confirmation rules are preserved.

## Server setup required before live use

The implementation does **not** apply migrations to a business database or install real credentials.

1. Back up the deployment database and agree a normal deployment window. Apply the new migration `20261016130000_shop_email_settings.js` through the project's migration workflow **against the explicitly verified deployment target**. It adds a separate table; it does not rewrite past migrations, users, orders, or passwords.
2. Generate a cryptographically random **32-byte key, base64-encoded**, and set `SHOP_SMTP_ENCRYPTION_KEY` in the backend's private environment/secret manager. Keep it stable across restarts and deployments and back it up securely. It must not be the JWT secret or an SMTP password. Never commit it or paste it into chat. No key was generated into the user's real configuration during implementation.
3. Deploy/restart the backend and updated frontend together. Until the table/key are available, the Email Settings panel cannot save credentials. Phone/password login does not depend on SMTP.
4. As Super Admin, select an existing shop and enter its actual sending-email details in the app. Repeat only for shops that need email delivery. Do not put SMTP host/user/password/sender into `.env`; old global SMTP variables are no longer consumed.
5. Save, send one test, and check the registered Super Admin inbox/spam folder. Then request a password OTP with the existing administrator/current password and leave without updating the password if only testing delivery. No new users, products, orders, or payments are needed.

The encryption key is a server secret, not per-shop configuration. If it is lost or changed, restore it; otherwise re-enter each shop's SMTP password under a valid replacement key. Existing encrypted credentials cannot be recovered without the original key. Transparent key rotation is not implemented.

## Interfaces and safety

Authenticated routes are `GET /api/shop-email-settings/:shopId`, `PUT /api/shop-email-settings/:shopId`, and `POST /api/shop-email-settings/:shopId/test`. The URL shop must match the authenticated request context. Writes/tests additionally require the Super Admin role at the service boundary, irrespective of menu permissions.

Save input: `host`, `port` (465 or 587), `username`, `from_email`, optional `password`, and `expected_revision` (null for first save). Test input accepts only the saved `expected_revision`; callers cannot supply a recipient, subject, message, or secret. Reads expose a configured/status indicator and last-test result; only Super Admin receives editable non-secret fields and `has_password`/`encryption_ready` flags.

The new table stores AES-256-GCM ciphertext with a random nonce and authentication tag, bound to the shop ID as authenticated data. Only the email service decrypts it for backend use. Application login passwords remain bcrypt hashes; SMTP credentials must be decryptable to authenticate to the sending service.

## Verification

Final verification: all **498 workspace tests passed** (backend 185, desktop 160, shared 153). The full isolated MySQL suite passed twice with the new migration and authenticated email-settings routes. The final run included forged-shop-header, absent-config, and simultaneous-first-save checks; it exited 0 on 2026-09-06 at 12:35 IST and removed `wrs_test_integrity_1788678182173_64aebe07` and its temporary server. It used a fake SMTP sender, not real recipients or provider credentials.

The final production build passed (3,565 modules). The strict bundle guard passed at 66.7 KB entry / 170.7 KB critical assets gzip. Full quiet ESLint, no-TypeScript and whitespace checks passed. The existing mixed static/dynamic `printBill.js` import warning remains non-fatal. Browser acceptance and actual SMTP delivery are not claimed by these results. Implementation commit: `c6102fd`, local only.

Coverage includes authenticated role/shop isolation, encrypted storage and masked reads, retained/replaced passwords, stale-save rejection, simultaneous test rate limiting, selected-shop sender versus administrator recipient, Super Admin self-service, incorrect password rejection, cross-shop target rejection, OTP confirmation, failed-send challenge cleanup, missing keys, sanitized provider errors, and ignoring old-test completion after new credentials are saved. Unit tests also check ciphertext copying/tampering, private DNS addresses, TLS options, strict schemas and client scope guards.

Repeat safe verification from the repository root:

```powershell
npm --workspaces --if-present test
node node_modules/eslint/bin/eslint.js "apps/**/*.{js,jsx,cjs,mjs}" "packages/**/*.{js,jsx,cjs,mjs}" --quiet
npm run check:no-ts
npm run build:desktop
node scripts/check-web-bundle-budget.mjs --strict
node apps/backend/scripts/run-native-isolated-integrity.js
git -c core.safecrlf=false diff --check
```

The native wrapper creates and removes its own test database/server; do not substitute ordinary migration or seed commands when testing. Live SMTP receipt and browser/operator acceptance remain separate gates. No real emails, business migrations, password changes or code pushes were performed during implementation.
