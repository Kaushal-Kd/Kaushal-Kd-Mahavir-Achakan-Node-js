import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSmtpAddress, sendSmtpMessage } from './smtpTransport.js';

const settings = {
  host: 'smtp.example.test',
  port: 587,
  username: 'test-user',
  password: 'secret-test',
  from_email: 'sender@example.test',
};
test('SMTP resolver rejects private, loopback, mapped-loopback and mixed DNS answers', async () => {
  for (const addresses of [
    ['127.0.0.1'],
    ['10.0.0.1'],
    ['169.254.169.254'],
    ['::1'],
    ['::ffff:127.0.0.1'],
    ['8.8.8.8', '192.168.1.2'],
    [],
  ]) {
    await assert.rejects(
      resolveSmtpAddress(settings.host, async () => addresses.map((address) => ({ address }))),
      /public email server/
    );
  }
  assert.equal(
    await resolveSmtpAddress(settings.host, async () => [{ address: '8.8.8.8' }]),
    '8.8.8.8'
  );
});
test('SMTP uses a validated pinned address, certificate hostname and mandatory TLS', async () => {
  for (const port of [465, 587]) {
    let options;
    let message;
    let closed = false;
    const result = await sendSmtpMessage(
      { ...settings, port },
      { to: 'admin@example.test', from: 'wrong@example.test', text: 'test' },
      {
        resolveAddress: async () => '8.8.8.8',
        createTransport: (opts) => {
          options = opts;
          return {
            sendMail: async (mail) => {
              message = mail;
              return { accepted: ['admin@example.test'], rejected: [] };
            },
            close: () => {
              closed = true;
            },
          };
        },
      }
    );
    assert.deepEqual(result, { accepted: true });
    assert.equal(options.host, '8.8.8.8');
    assert.equal(options.tls.servername, settings.host);
    assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.secure, port === 465);
    assert.equal(options.requireTLS, true);
    assert.equal(options.disableFileAccess, true);
    assert.equal(message.from, settings.from_email);
    assert.equal(closed, true);
  }
});
test('provider errors are sanitized and sockets close on rejection', async () => {
  let closed = false;
  await assert.rejects(
    sendSmtpMessage(
      settings,
      {},
      {
        resolveAddress: async () => '8.8.8.8',
        createTransport: () => ({
          sendMail: async () => {
            throw Object.assign(new Error('provider echoed secret-test'), { code: 'EAUTH' });
          },
          close: () => {
            closed = true;
          },
        }),
      }
    ),
    (error) => /login was rejected/.test(error.message) && !error.message.includes('secret-test')
  );
  assert.equal(closed, true);
  await assert.rejects(
    sendSmtpMessage(
      settings,
      {},
      {
        resolveAddress: async () => '8.8.8.8',
        createTransport: () => ({
          sendMail: async () => ({ accepted: [], rejected: ['x'] }),
          close() {},
        }),
      }
    ),
    /did not accept/
  );
});
