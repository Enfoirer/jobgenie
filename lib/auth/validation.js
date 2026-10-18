export function authError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') throw authError('Enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw authError('Enter a valid email address.');
  return email;
}

export function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw authError('Use at least 8 characters and at most 72 UTF-8 bytes for your password.');
  }
  return password;
}
