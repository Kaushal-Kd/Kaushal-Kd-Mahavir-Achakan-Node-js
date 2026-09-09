#!/usr/bin/env node
/**
 * Run backend + frontend performance audits.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERF_DIR } from './perf-report-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

async function main() {
  if (process.env.PERF_REBENCHMARK === '1') {
    for (const name of ['backend-api-report.json', 'frontend-page-report.json']) {
      const src = path.join(PERF_DIR, name);
      const dest = path.join(PERF_DIR, name.replace('.json', '.baseline.json'));
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Baseline snapshot: ${dest}\n`);
      }
    }
  }

  console.log('=== Backend API benchmark ===\n');
  await run('benchmark-apis.js');
  console.log('\n=== Frontend page audit ===\n');
  await run('audit-frontend-pages.js');
  console.log('\nDone. See docs/perf/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
