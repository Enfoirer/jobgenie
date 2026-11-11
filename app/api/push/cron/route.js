import { pushHandler } from '@/lib/push/handlers';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = pushHandler('cron');
export const POST = GET;
