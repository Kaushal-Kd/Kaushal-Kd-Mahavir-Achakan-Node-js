import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { env } from '../../config/env.js';
import knex from '../../db/knex.js';
import {
  decryptEmailPassword,
  emailEncryptionReady,
  encryptEmailPassword,
} from '../../lib/emailSecret.js';
import { sendSmtpMessage, smtpFailureMessage } from '../../lib/smtpTransport.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

import { shopEmailSettingsSchema, testShopEmailSchema } from './schema.js';

export function createShopEmailService({
  database = knex,
  getKey = () => env.SHOP_SMTP_ENCRYPTION_KEY,
  deliver = sendSmtpMessage,
  now = () => new Date(),
} = {}) {
  async function assertAccess(shopId, actor, edit = false) {
    if (
      !actor ||
      (edit ? actor.role !== 'super_admin' : !['super_admin', 'shop_admin'].includes(actor.role))
    ) {
      throw forbidden(
        edit
          ? 'Only Super Admin can change or test email settings'
          : 'Only administrators can view email readiness'
      );
    }
    const shop = await database('shops')
      .where({ id: shopId, is_active: true })
      .first('id', 'shop_name');
    if (!shop) throw notFound('Active shop not found');
    if (
      actor.role !== 'super_admin' &&
      !(await database('users_shops')
        .where({ user_id: actor.id, shop_id: shopId })
        .first('user_id'))
    ) {
      throw forbidden('You do not have access to this shop');
    }
    return shop;
  }

  function readiness(row) {
    let configured = false;
    if (row && emailEncryptionReady(getKey())) {
      try {
        configured = Boolean(decryptEmailPassword(row.password_ciphertext, row.shop_id, getKey()));
      } catch {
        /* Report locked credentials without exposing them. */
      }
    }
    return {
      configured,
      status: !row ? 'not_configured' : configured ? 'configured' : 'credentials_locked',
      revision: row?.revision || null,
      last_test_at: row?.last_test_at || null,
      last_test_status: row?.last_test_status || null,
    };
  }

  async function getReadiness(shopId) {
    return readiness(await database('shop_email_settings').where({ shop_id: shopId }).first());
  }

  async function getSettings(shopId, actor) {
    const shop = await assertAccess(shopId, actor);
    const row = await database('shop_email_settings').where({ shop_id: shopId }).first();
    const result = { shop_id: shopId, shop_name: shop.shop_name, ...readiness(row) };
    if (actor.role === 'super_admin')
      Object.assign(result, {
        host: row?.host || '',
        port: row?.port || 587,
        username: row?.username || '',
        from_email: row?.from_email || '',
        has_password: Boolean(row?.password_ciphertext),
        encryption_ready: emailEncryptionReady(getKey()),
      });
    return result;
  }

  async function saveSettings(shopId, actor, input) {
    await assertAccess(shopId, actor, true);
    const body = validate(shopEmailSettingsSchema, input);
    if (!emailEncryptionReady(getKey()))
      throw badRequest(
        'Ask the server administrator to configure SHOP_SMTP_ENCRYPTION_KEY before saving email credentials.'
      );
    await database.transaction(async (trx) => {
      await trx('shops').where({ id: shopId }).forUpdate().first('id');
      const previous = await trx('shop_email_settings').where({ shop_id: shopId }).first();
      if ((previous?.revision || null) !== body.expected_revision) {
        throw conflict('Email settings changed. Reload them before saving again.');
      }
      const password =
        body.password ||
        (previous && decryptEmailPassword(previous.password_ciphertext, shopId, getKey()));
      if (!password) throw badRequest('Enter an SMTP password or app password for the first save.');
      const row = {
        shop_id: shopId,
        host: body.host,
        port: body.port,
        username: body.username,
        from_email: body.from_email,
        password_ciphertext: encryptEmailPassword(password, shopId, getKey()),
        revision: randomUUID(),
        updated_by_user_id: actor.id,
        updated_at: trx.fn.now(),
        last_test_at: null,
        last_test_status: null,
      };
      await trx('shop_email_settings').insert(row).onConflict('shop_id').merge(row);
    });
    return getSettings(shopId, actor);
  }

  async function loadSender(shopId, row) {
    const settings =
      row || (await database('shop_email_settings').where({ shop_id: shopId }).first());
    if (!settings)
      throw badRequest(
        'Email OTP is not configured for this shop. Ask Super Admin to open Settings → Shops / Branches → Email Settings.'
      );
    return {
      host: settings.host,
      port: settings.port,
      username: settings.username,
      from_email: settings.from_email,
      password: decryptEmailPassword(settings.password_ciphertext, shopId, getKey()),
    };
  }

  async function sendPasswordOtp(shopId, { to, name, otp, expiresInMinutes }) {
    const recipient = validate(z.string().email(), to);
    const settings = await loadSender(shopId);
    try {
      await deliver(settings, {
        to: recipient,
        subject: 'Wedding Rent System password change OTP',
        text: [
          `Hello ${name || 'Admin'},`,
          '',
          `Your password change OTP is ${otp}.`,
          `It expires in ${expiresInMinutes} minutes and can be used only once.`,
          '',
          'If you did not request this change, contact your administrator immediately.',
        ].join('\n'),
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw badRequest(smtpFailureMessage(error));
    }
  }

  async function sendTest(shopId, actor, input) {
    const shop = await assertAccess(shopId, actor, true);
    const body = validate(testShopEmailSchema, input);
    const recipient = await database('users')
      .where({ id: actor.id, role: 'super_admin', is_active: true })
      .first('email');
    if (!z.string().email().safeParse(recipient?.email).success)
      throw badRequest('Add a valid email to your Super Admin profile before sending a test.');
    const requestedAt = now();
    const settings = await database.transaction(async (trx) => {
      await trx('shops').where({ id: shopId }).forUpdate().first('id');
      const row = await trx('shop_email_settings').where({ shop_id: shopId }).first();
      if (!row || row.revision !== body.expected_revision)
        throw conflict('Save and reload the current email settings before sending a test.');
      if (row.test_requested_at && requestedAt - new Date(row.test_requested_at) < 60000) {
        throw new AppError(429, 'Wait one minute before sending another test email.', {
          code: 'RATE_LIMITED',
        });
      }
      const sender = await loadSender(shopId, row);
      await trx('shop_email_settings')
        .where({ shop_id: shopId })
        .update({ test_requested_at: requestedAt });
      return sender;
    });
    try {
      await deliver(settings, {
        to: recipient.email,
        subject: 'Wedding Rent System email setup test',
        text: `Email settings test for ${shop.shop_name}.\nThis is not a password OTP and does not change any account or booking.`,
      });
      await database('shop_email_settings')
        .where({ shop_id: shopId, revision: body.expected_revision })
        .update({ last_test_at: now(), last_test_status: 'accepted' });
    } catch (error) {
      await database('shop_email_settings')
        .where({ shop_id: shopId, revision: body.expected_revision })
        .update({ last_test_at: now(), last_test_status: 'failed' });
      if (error instanceof AppError) throw error;
      throw badRequest(smtpFailureMessage(error));
    }
    return {
      accepted: true,
      message:
        'The email server accepted the test. Check your registered Super Admin inbox, including spam.',
    };
  }

  return { getSettings, getReadiness, saveSettings, sendTest, sendPasswordOtp };
}

export const shopEmailService = createShopEmailService();
