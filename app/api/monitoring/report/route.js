import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { createReportHandler } from '@/lib/monitoring/report';
export const POST = createReportHandler({ authenticate: async () => (await getServerSession(authOptions))?.user?.id, connect: dbConnect });
