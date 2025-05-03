// app/api/uploads/route.js
import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // In a real app, you would want to use a storage service like S3
    // For this example, we'll save to a 'uploads' folder
    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    const fileName = `${session.user.id}-${Date.now()}-${file.name}`;
    const filePath = join(uploadsDir, fileName);
    
    await writeFile(filePath, buffer);
    
    return NextResponse.json({ 
      success: true, 
      fileName, 
      filePath: `/uploads/${fileName}` 
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
