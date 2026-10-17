export const DEFAULT_SYNC_LIMIT = 10;
export const MAX_SYNC_LIMIT = 50;

export function normalizeSyncLimit(value = DEFAULT_SYNC_LIMIT) {
  const isIntegerString = typeof value === 'string' && /^\d+$/.test(value.trim());
  const number = typeof value === 'number' || isIntegerString ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_SYNC_LIMIT) {
    throw Object.assign(new Error(`limit must be an integer between 1 and ${MAX_SYNC_LIMIT}`), { status: 400 });
  }
  return number;
}

export function parseMailSyncOptions(searchParams) {
  if (searchParams.getAll('limit').length > 1 || searchParams.getAll('provider').length > 1) {
    throw Object.assign(new Error('Repeated sync parameters are not supported'), { status: 400 });
  }
  const provider = searchParams.get('provider');
  if (provider !== null && !['gmail', 'outlook'].includes(provider)) {
    throw Object.assign(new Error('provider must be gmail or outlook'), { status: 400 });
  }
  const limit = normalizeSyncLimit(searchParams.has('limit') ? searchParams.get('limit') : undefined);
  return { limit, ...(provider ? { provider } : {}) };
}
