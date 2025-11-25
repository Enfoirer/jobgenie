// app/api/mail/accounts/[id]/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import dbConnect from '@/lib/mongodb';
import MailAccount from '@/lib/models/MailAccount';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function DELETE(request, { params }) {
  await dbConnect();

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = params;
  const account = await MailAccount.findById(id);

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  if (account.userId.toString() !== session.user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  await MailAccount.findByIdAndDelete(id);

  return NextResponse.json({ success: true });
}
