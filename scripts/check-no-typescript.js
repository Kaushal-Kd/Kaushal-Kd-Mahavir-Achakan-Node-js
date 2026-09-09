#!/usr/bin/env node
/**
 * TypeScript Guard (see requirements §97).
 *
 * Fails the build if any .ts / .tsx / .d.ts file (or tsconfig.json) is found
 * in the repository, excluding node_modules and build output.
 *
 * Run via `npm run check:no-ts` or as a pre-commit hook.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'build',
  'coverage',
  'release',
  '.next',
  '.turbo',
  '.cache',
]);

const FORBIDDEN_EXTENSIONS = ['.ts', '.tsx'];
const FORBIDDEN_FILES = new Set(['tsconfig.json']);

/** @type {string[]} */
const violations = [];

/**
 * @param {string} dir
 */
function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const base = entry.name;
    if (base.endsWith('.d.ts')) {
      violations.push(full);
      continue;
    }
    const ext = path.extname(base);
    if (FORBIDDEN_EXTENSIONS.includes(ext)) {
      violations.push(full);
      continue;
    }
    if (FORBIDDEN_FILES.has(base) || /^tsconfig\..*\.json$/.test(base)) {
      violations.push(full);
    }
  }
}

walk(ROOT);

if (violations.length > 0) {
  console.error('\n\u274c TypeScript files / configs are not allowed in this project (see §97).');
  console.error('   Use .jsx / .js only. Violations found:\n');
  for (const v of violations) {
    console.error('   - ' + path.relative(ROOT, v));
  }
  console.error('\nRemove them or convert to JavaScript before committing.\n');
  process.exit(1);
}

console.info('\u2705 No TypeScript files found. All-JSX rule satisfied.');
