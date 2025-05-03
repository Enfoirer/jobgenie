// app/api/auth/[...nextauth]/route.js
import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import dbConnect from '@/lib/mongodb';
import User from '@/lib/models/User';

// Simplified auth configuration for testing
export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        try {
          await dbConnect();
          
          // For testing - first check if the user exists
          const user = await User.findOne({ email: credentials.email });
          
          if (user) {
            // User exists, check password
            const isPasswordValid = await bcrypt.compare(
              credentials.password,
              user.password
            );
            
            if (isPasswordValid) {
              return {
                id: user._id.toString(),
                email: user.email,
                name: user.name || 'User',
              };
            }
          }
          
          // If we reach here, authentication failed
          return null;
        } catch (error) {
          console.error('Auth error:', error);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  debug: process.env.NODE_ENV === 'development',
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };