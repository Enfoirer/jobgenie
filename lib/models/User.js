// lib/models/User.js
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [false, 'Please provide a name'],
    trim: true,
    default: 'User'
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [4, 'Password should be at least 4 characters long']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// This is important for Next.js to prevent duplicate model errors
const User = mongoose.models.User || mongoose.model('User', UserSchema);

export default User;