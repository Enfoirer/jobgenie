// app/api/uploads/[id]/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import mongoose from 'mongoose';

// File Schema (same as in uploads/route.js)
const FileSchema = new mongoose.Schema({
  name: String,
  type: String,
  size: String,
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fileData: Buffer,
  uploadDate: {
    type: Date,
    default: Date.now
  }
});

const File = mongoose.models.File || mongoose.model('File', FileSchema);

export async function DELETE(request, { params }) {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    const { id } = params;
    
    console.log(`DELETE /api/uploads/${id} - Deleting file`);
    
    // Find file and verify ownership
    const file = await File.findById(id);
    
    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    if (file.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    // Delete file record from database
    await File.findByIdAndDelete(id);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`DELETE /api/uploads/[id] - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}