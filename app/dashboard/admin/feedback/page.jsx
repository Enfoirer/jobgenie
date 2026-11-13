import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin/feedback';
import FeedbackReview from '@/components/FeedbackReview';
export const dynamic = 'force-dynamic';
export default async function AdminFeedbackPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  await dbConnect();
  try { await requireAdmin(session.user.id); }
  catch (error) {
    if (error.status !== 403) throw error;
    return <p role="alert">Administrator access required.</p>;
  }
  return <FeedbackReview key={session.user.id} />;
}
