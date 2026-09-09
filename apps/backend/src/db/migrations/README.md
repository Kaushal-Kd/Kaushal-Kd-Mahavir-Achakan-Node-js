# Database migrations

Knex runs every `.js` file here in **filename order**. Each file runs once; the name is stored in `knex_migrations`.

## Do not delete applied migrations

If a migration has already run on any environment (local, staging, production), **keep the file**. Removing it breaks:

- `knex migrate:rollback`
- New clones that expect a consistent history
- Matching `knex_migrations` rows to files on disk

Project rule (`AGENTS.md`): **never edit or delete past migrations** that have shipped—add a new migration instead.

## What was removed

These two files were a **no-op pair** (tables created, then dropped when the purchase-bills feature was removed):

- `20260606100000_create_purchase_bills_tables.js`
- `20260607120000_drop_purchase_bills_tables.js`

End schema is unchanged without them. Existing databases should delete the matching rows from `knex_migrations` (done automatically on dev when cleaning up).

## Why there are many files

Most migrations are still required: they reflect real schema changes (add/drop columns, indexes, data backfills, renames). Pairs like `drop X` → `create X` are not redundant if the table shape changed. Data migrations (backfill, 24h→12h time format, legacy settings → app settings) only run once on upgrade paths.

To reduce count in the future, use fewer migrations per feature before the first production deploy, or plan a controlled **baseline squash** (new DB + reset `knex_migrations`)—not done in day-to-day development.

## Existing tables but migration history missing

If `migrate:latest` fails with **Table 'shops' already exists** (or similar), the schema is ahead of `knex_migrations`—common after a DB restore or lost migration table.

`npm run migrate` runs `migrate:sync` first. It stamps pending migrations whose tables/columns are already present, then applies only the remaining migrations.

Manual reconcile only:

```bash
npm run migrate:sync --workspace @wrs/backend
npm run migrate --workspace @wrs/backend
```
