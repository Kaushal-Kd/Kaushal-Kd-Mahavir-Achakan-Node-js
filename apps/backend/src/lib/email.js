import { shopEmailService } from '../modules/shop-email/service.js';

export async function sendPasswordOtpEmail({ shopId, ...message }) {
  return shopEmailService.sendPasswordOtp(shopId, message);
}
