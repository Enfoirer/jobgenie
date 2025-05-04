// app/api/uploads/download/[id]/route.js
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

export async function GET(request, { params }) {
  try {
    await dbConnect();
    
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = params;
    
    // Find the file record
    const fileRecord = await File.findById(id);
    
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    if (fileRecord.userId.toString() !== session.user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    
    // If no file data is found
    if (!fileRecord.fileData) {
      return NextResponse.json({ error: 'File content not found' }, { status: 404 });
    }
    
    // Return the file with appropriate headers
    return new NextResponse(fileRecord.fileData, {
      headers: {
        'Content-Type': fileRecord.type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${fileRecord.name}"`,
        'Content-Length': fileRecord.fileData.length.toString()
      }
    });
  } catch (error) {
    console.error(`GET /api/uploads/download/[id] - Error:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}