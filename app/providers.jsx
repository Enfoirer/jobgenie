'use client';

import { SessionProvider } from 'next-auth/react';
import ErrorMonitor from '@/components/ErrorMonitor';

export function Providers({ children }) {
  return <SessionProvider><ErrorMonitor />{children}</SessionProvider>;
}
