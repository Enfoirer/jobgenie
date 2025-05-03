// app/api/uploads/route.js
import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
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
  filePath: String,
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
    
    const userFiles = await File.find({ userId: session.user.id }).sort({ uploadDate: -1 });
    console.log(`GET /api/uploads - Found ${userFiles.length} files`);
    
    return NextResponse.json({ files: userFiles });
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

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Create uploads directory if it doesn't exist
    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    try {
      await mkdir(uploadsDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }
    
    // Create a unique filename
    const fileName = `${session.user.id.substring(0, 8)}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '')}`;
    const filePath = join(uploadsDir, fileName);
    
    console.log(`POST /api/uploads - Saving file ${fileName}`);
    
    // Write the file to the public/uploads directory
    await writeFile(filePath, buffer);
    
    // Create a record in the database
    const fileRecord = await File.create({
      name: file.name,
      type: file.type,
      size: `${Math.round(file.size / 1024)} KB`,
      userId: session.user.id,
      filePath: `/uploads/${fileName}`
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
        filePath: fileRecord.filePath
      }
    });
  } catch (error) {
    console.error('POST /api/uploads - Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}