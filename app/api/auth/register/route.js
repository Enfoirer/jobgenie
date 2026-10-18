// app/api/auth/register/route.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import dbConnect from '@/lib/mongodb';
import User from '@/lib/models/User';
import { normalizeEmail, validateNewPassword } from '@/lib/auth/validation';

export async function POST(request) {
  try {
    // Connect to database
    await dbConnect();
    
    // Get request body
    const body = await request.json();
    const { name, password } = body;
    const email = normalizeEmail(body.email);
    validateNewPassword(password);
    

    
    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }
    
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Create new user
    const user = await User.create({
      name: name || 'New User',
      email,
      password: hashedPassword,
    });
    
    // Don't send the password back
    const newUser = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    };
    

    
    return NextResponse.json({ user: newUser }, { status: 201 });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: error.status === 400 ? error.message : 'Registration failed. Please try again.' },
      { status: error.status === 400 ? 400 : 500 }
    );
  }
}