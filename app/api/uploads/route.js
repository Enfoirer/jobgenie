// app/api/uploads/route.js
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import dbConnect from '@/lib/mongodb';
import mongoose from 'mongoose';

// Create a Schema for uploaded files
const FileSchema = new mongoose.Schema({
  name: String,
  type: String,
  size: String,
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fileData: Buffer, // Store file directly in MongoDB as Buffer
  uploadDate: {
    type: Date,
    default: Date.now
  }
});

// Check if model exists to prevent Next.js hot-reload issues
const File = mongoose.models.File || mongoose.model('File', FileSchema);

export async function GET() {
  try {
    await dbConnect();
    console.log('GET /api/uploads - Connected to database');
    
    const session = await getServerSession(authOptions);
    
    if (!session) {
      console.log('GET /api/uploads - Not authenticated');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    console.log('GET /api/uploads - Authenticated as', session.user.email);
    
    const userFiles = await File.find({ userId: session.user.id }, { fileData: 0 }).sort({ uploadDate: -1 });
    console.log(`GET /api/uploads - Found ${userFiles.length} files`);
    
    // Transform to include download URLs
    const filesWithUrls = userFiles.map(file => ({
      id: file._id,
      name: file.name,
      type: file.type,
      size: file.size,
      uploadDate: file.uploadDate,
      filePath: `/api/uploads/download/${file._id}`
    }));
    
    return NextResponse.json({ files: filesWithUrls });
  } catch (error) {
    console.error('GET /api/uploads - Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await dbConnect();
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use formData to handle file uploads
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Size check
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      console.log(`File too large: ${file.size} bytes`);
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    // Get file as buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    console.log(`POST /api/uploads - Uploading file: ${file.name}, size: ${buffer.length} bytes`);
    
    // Create a record in the database with the file data
    const fileRecord = await File.create({
      name: file.name,
      type: file.type,
      size: `${Math.round(file.size / 1024)} KB`,
      userId: session.user.id,
      fileData: buffer // Store the actual file data in MongoDB
    });
    
    console.log(`POST /api/uploads - File saved successfully: ${fileRecord._id}`);
    
    return NextResponse.json({ 
      success: true, 
      file: {
        id: fileRecord._id,
        name: fileRecord.name,
        type: fileRecord.type,
        size: fileRecord.size,
        uploadDate: fileRecord.uploadDate,
        filePath: `/api/uploads/download/${fileRecord._id}`
      }
    });
  } catch (error) {
    console.error('POST /api/uploads - Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}