import { APP_NAME } from '@wrs/shared';

import { env } from '../config/env.js';
import { shopEmailService } from '../modules/shop-email/service.js';
import { sendSmtpMessage } from './smtpTransport.js';
import { badRequest } from '../utils/errors.js';

export async function sendPasswordOtpEmail({ shopId, ...message }) {
  return shopEmailService.sendPasswordOtp(shopId, message);
}

export function getSystemSmtpSettings() {
  const host = String(env.SMTP_HOST || '').trim();
  const username = String(env.SMTP_USER || '').trim();
  const password = String(env.SMTP_PASSWORD || '').trim();
  const from_email = String(env.SMTP_FROM || username).trim();
  const port = Number(env.SMTP_PORT || 587);
  if (!host || !username || !password || !from_email) {
    throw badRequest('Password reset email is not configured. Contact your administrator.');
  }
  return { host, port, username, password, from_email };
}

export async function sendForgotPasswordOtpEmail({ to, name, otp, expiresInMinutes }) {
  const settings = getSystemSmtpSettings();
  return sendSmtpMessage(settings, {
    to,
    subject: `${APP_NAME} password reset OTP`,
    text: [
      `Hello ${name || 'Admin'},`,
      '',
      `Your password reset OTP is ${otp}.`,
      `It expires in ${expiresInMinutes} minutes and can be used only once.`,
      '',
      'If you did not request this, ignore this email and contact your administrator.',
    ].join('\n'),
  });
}
