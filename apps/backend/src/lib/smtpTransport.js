import { lookup } from 'node:dns/promises';

import ipaddr from 'ipaddr.js';
import nodemailer from 'nodemailer';

import { badRequest } from '../utils/errors.js';

export function smtpFailureMessage(error) {
  if (error?.code === 'EAUTH')
    return 'Email login was rejected. Check the SMTP username and password/app password.';
  if (
    ['ESOCKET', 'ETIMEDOUT', 'ECONNECTION', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED'].includes(
      error?.code
    )
  ) {
    return 'Could not connect securely to the email server. Check the hostname, port and server network access.';
  }
  return 'The email server did not accept the message. Check the sender settings and try again.';
}

export async function resolveSmtpAddress(host, lookupHost = lookup) {
  let addresses;
  try {
    addresses = await lookupHost(host, { all: true, verbatim: true });
  } catch {
    throw badRequest('The email server hostname could not be resolved.');
  }
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) => !ipaddr.isValid(address) || ipaddr.process(address).range() !== 'unicast'
    )
  ) {
    throw badRequest(
      'Use a public email server. Local and private network addresses are not allowed.'
    );
  }
  return addresses[0].address;
}

export async function sendSmtpMessage(
  settings,
  message,
  { resolveAddress = resolveSmtpAddress, createTransport = nodemailer.createTransport } = {}
) {
  const address = await resolveAddress(settings.host);
  let transport;
  try {
    // Pin the validated address while verifying TLS against the configured hostname.
    transport = createTransport({
      host: address,
      port: settings.port,
      secure: settings.port === 465,
      requireTLS: true,
      tls: { servername: settings.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      auth: { user: settings.username, pass: settings.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const result = await transport.sendMail({ ...message, from: settings.from_email });
    if (!result?.accepted?.length || result.rejected?.length) throw new Error('Not accepted');
    return { accepted: true };
  } catch (error) {
    throw badRequest(smtpFailureMessage(error));
  } finally {
    try {
      transport?.close();
    } catch {
      /* Do not expose provider details from socket cleanup. */
    }
  }
}
