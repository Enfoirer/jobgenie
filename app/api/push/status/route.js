import { pushHandler } from '@/lib/push/handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = pushHandler('status');
