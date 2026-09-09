export function emailSettingsForm(data) {
  return {
    host: data?.host || '',
    port: Number(data?.port || 587),
    username: data?.username || '',
    from_email: data?.from_email || '',
    password: '',
    expected_revision: data?.revision || null,
  };
}

export function emailSettingsDirty(form, data) {
  const saved = emailSettingsForm(data);
  return ['host', 'port', 'username', 'from_email', 'password'].some(
    (key) => form[key] !== saved[key]
  );
}

export function assertEmailSettingsScope(expected, current) {
  if (
    !expected.shopId ||
    !expected.userId ||
    expected.shopId !== current.shopId ||
    expected.userId !== current.userId ||
    current.role !== expected.role
  ) {
    throw new Error('Shop or login changed. Reopen Email Settings.');
  }
}
