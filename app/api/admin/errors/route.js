import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createErrorReviewHandler } from '@/lib/admin/errors';
import { observeRoute } from '@/lib/monitoring/server';
export const dynamic = 'force-dynamic';
export const GET = observeRoute(createErrorReviewHandler({ authenticate: async () => (await getServerSession(authOptions))?.user?.id, connect: dbConnect }), '/api/admin/errors');
