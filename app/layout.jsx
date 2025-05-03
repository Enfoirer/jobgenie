// app/layout.jsx
import { Inter } from 'next/font/google';
import './globals.css';

// Initialize the Inter font with the latin subset
const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'JobTrack - Application Tracker',
  description: 'Track and manage your job applications',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}