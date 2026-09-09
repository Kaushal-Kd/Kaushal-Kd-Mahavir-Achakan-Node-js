import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { badRequest } from '../utils/errors.js';

function encryptionKey(value) {
  const key = Buffer.from(String(value || ''), 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw badRequest(
      'Email credential protection is not configured. Ask the server administrator to set SHOP_SMTP_ENCRYPTION_KEY.'
    );
  }
  return key;
}

export function emailEncryptionReady(key) {
  try {
    encryptionKey(key);
    return true;
  } catch {
    return false;
  }
}

export function encryptEmailPassword(password, shopId, keyValue) {
  const key = encryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`shop-smtp:v1:${shopId}`));
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptEmailPassword(value, shopId, keyValue) {
  const key = encryptionKey(keyValue);
  try {
    const [version, nonce, tag, content, extra] = String(value).split('.');
    if (version !== 'v1' || extra !== undefined || !nonce || !tag || !content) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
    decipher.setAAD(Buffer.from(`shop-smtp:v1:${shopId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(content, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw badRequest(
      'Saved email credentials cannot be unlocked. Restore the server encryption key or replace this shop’s SMTP password.'
    );
  }
}
