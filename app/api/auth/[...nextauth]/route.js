import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { encode } from 'next-auth/jwt';
import bcrypt from 'bcrypt';
import dbConnect from '@/lib/mongodb';
import User from '@/lib/models/User';
import { normalizeEmail } from '@/lib/auth/validation';
import { REMEMBERED_SESSION_SECONDS, startAuthToken, validAuthToken } from '@/lib/auth/session';

export const authOptions = {
  providers: [CredentialsProvider({
    name: 'Credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
      rememberMe: { label: 'Remember me', type: 'checkbox' },
    },
    async authorize(credentials) {
      try {
        const email = normalizeEmail(credentials?.email);
        if (typeof credentials?.password !== 'string' || !credentials.password || Buffer.byteLength(credentials.password, 'utf8') > 72) return null;
        await dbConnect();
        const user = await User.findOne({ email });
        if (!user || !await bcrypt.compare(credentials.password, user.password)) return null;
        return { id: String(user._id), email: user.email, name: user.name || 'User',
          authVersion: user.authVersion || 0, rememberMe: credentials.rememberMe === 'true' };
      } catch { return null; }
    },
  })],
  session: { strategy: 'jwt', maxAge: REMEMBERED_SESSION_SECONDS },
  jwt: {
    async encode(params) {
      const expires = params.token?.authExpiresAt ?? params.token?.exp;
      const maxAge = typeof expires === 'number' ? Math.max(0, expires - Math.floor(Date.now() / 1000)) : 0;
      return encode({ ...params, maxAge });
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) return startAuthToken(token, user);
      await dbConnect();
      const current = typeof token.id === 'string' && /^[a-f0-9]{24}$/i.test(token.id)
        ? await User.findById(token.id, { authVersion: 1 }).lean() : null;
      if (!validAuthToken(token, current)) throw new Error('Session expired or revoked');
      // Fix legacy expiry too: polling must never extend either session duration.
      token.authExpiresAt ??= token.exp;
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.expires = new Date(token.authExpiresAt * 1000).toISOString();
      return session;
    },
  },
  pages: { signIn: '/login' },
  debug: process.env.NODE_ENV === 'development',
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
