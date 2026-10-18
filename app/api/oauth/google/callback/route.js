import { oauthHandler } from '@/lib/oauth/handlers';
export const GET = oauthHandler('google', 'callback');
