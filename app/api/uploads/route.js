import { uploadHandler } from '@/lib/uploads/handlers';
export const GET = uploadHandler('list');
export const POST = uploadHandler('create');
