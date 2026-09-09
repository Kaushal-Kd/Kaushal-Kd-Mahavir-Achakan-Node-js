import { z } from 'zod';

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^\d{10}$/.test(digits)) return digits;
  return /^91\d{10}$/.test(digits) ? digits.slice(2) : null;
}

/** Readiness and the mode-change gate must reject exactly the same accounts. */
export function assessLoginReadiness(users) {
  const counts = new Map();
  for (const user of users) {
    if ((user.is_active === false || user.is_active === 0) && !String(user.login_phone || '').trim()) continue;
    const phone = normalizedPhone(user.login_phone || user.phone);
    if (phone) counts.set(phone, (counts.get(phone) || 0) + 1);
  }
  const blocked = [];
  for (const user of users) {
    if (user.is_active === false || user.is_active === 0) continue;
    const issues = [];
    const raw = String(user.login_phone || '').trim();
    const normalized = normalizedPhone(raw || user.phone);
    if (!raw) issues.push('Login phone is missing; save the real phone number on this account.');
    else if (!/^\d{10}$/.test(raw) || raw !== user.login_phone) {
      issues.push('Login phone must be saved as exactly 10 digits.');
    }
    if (!normalized) issues.push('Enter a valid 10-digit phone number.');
    else if (counts.get(normalized) > 1) issues.push('This phone number is used by another account.');
    if (['super_admin', 'shop_admin'].includes(user.role)
      && !z.string().email().safeParse(String(user.email || '').trim()).success) {
      issues.push('A valid administrator email is required for password OTP.');
    }
    if (issues.length) blocked.push({
      id: user.id,
      name: user.name,
      role: user.role,
      phone: user.phone || user.login_phone || '',
      email: user.email || '',
      reason: issues.join(' '),
      issues,
    });
  }
  return { ready_for_phone_only: blocked.length === 0, blocked };
}
