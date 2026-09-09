import { spawn } from 'node:child_process';
import { mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import mysql from 'mysql2/promise';

const executable =
  process.env.WRS_TEST_MYSQLD || 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe';
const temporaryRoot = await realpath(tmpdir());
const directory = await mkdtemp(join(temporaryRoot, 'wrs-mysql-'));
const resolvedDirectory = await realpath(directory);
if (
  !resolvedDirectory.startsWith(temporaryRoot + sep) ||
  !resolvedDirectory.slice(temporaryRoot.length + 1).startsWith('wrs-mysql-')
) {
  throw new Error('Unsafe temporary MySQL data directory');
}
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let mysqlProcess;
let port;
const testPassword = randomBytes(24).toString('hex');
const run = (command, args, options = {}) =>
  new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveExit() : reject(new Error(`Isolated test process exited ${code}`))
    );
  });
try {
  await run(executable, [
    '--no-defaults',
    '--initialize-insecure',
    `--datadir=${directory}`,
    '--console',
  ]);
  port = await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const selected = server.address().port;
      server.close(() => resolvePort(selected));
    });
  });
  const initializationFile = join(directory, 'test-user.sql');
  await writeFile(
    initializationFile,
    `CREATE USER 'wrs_test'@'127.0.0.1' IDENTIFIED BY '${testPassword}';\nGRANT ALL PRIVILEGES ON *.* TO 'wrs_test'@'127.0.0.1';\n`,
    { mode: 0o600 }
  );
  mysqlProcess = spawn(
    executable,
    [
      '--no-defaults',
      `--datadir=${directory}`,
      `--port=${port}`,
      `--init-file=${initializationFile}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=OFF',
      '--skip-name-resolve',
      '--console',
      '--innodb-flush-log-at-trx-commit=2',
      '--sync-binlog=0',
      '--skip-log-bin',
    ],
    { windowsHide: true, stdio: 'inherit' }
  );
  let startupError;
  mysqlProcess.on('error', (error) => {
    startupError = error;
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (startupError) throw startupError;
    if (mysqlProcess.exitCode != null)
      throw new Error('Isolated MySQL stopped before becoming ready');
    try {
      const probe = await mysql.createConnection({
        host: '127.0.0.1',
        port,
        user: 'wrs_test',
        password: testPassword,
        connectTimeout: 1000,
      });
      await probe.end();
      ready = true;
      break;
    } catch {
      await new Promise((resume) => setTimeout(resume, 500));
    }
  }
  if (!ready) throw new Error('Isolated MySQL did not become ready');
  console.info('Temporary loopback MySQL is ready; starting synthetic database runner.');
  await run(process.execPath, [join(backendRoot, 'scripts/run-isolated-integrity.js')], {
    cwd: backendRoot,
    env: {
      ...process.env,
      WRS_TEST_DB_HOST: '127.0.0.1',
      WRS_TEST_DB_PORT: String(port),
      WRS_TEST_DB_USER: 'wrs_test',
      WRS_TEST_DB_PASSWORD: testPassword,
    },
  });
} catch (error) {
  console.error('Isolated integration failed:', error.message);
  process.exitCode = 1;
} finally {
  if (mysqlProcess && mysqlProcess.exitCode == null) {
    const exited = new Promise((resume) => mysqlProcess.once('exit', resume));
    try {
      const admin = await mysql.createConnection({
        host: '127.0.0.1',
        port,
        user: 'wrs_test',
        password: testPassword,
        connectTimeout: 1000,
      });
      await admin.query('SHUTDOWN');
      await admin.end();
    } catch {
      if (process.platform === 'win32')
        await run('taskkill.exe', ['/PID', String(mysqlProcess.pid), '/T', '/F']).catch(() => {});
      else mysqlProcess.kill();
    }
    await exited;
  }
  try {
    await rm(resolvedDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    console.info(
      'Removed the temporary MySQL instance and its synthetic data. Existing MySQL service was not changed.'
    );
  } catch (error) {
    console.warn(
      `Temporary instance stopped; cleanup needs retry at ${resolvedDirectory}: ${error.code}`
    );
  }
}
