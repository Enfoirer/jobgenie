// app/dashboard/layout.jsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

export default function DashboardLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  
  // Check if the user is authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Show loading state while checking authentication
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <h1 className="mt-6 text-xl font-semibold text-gray-700">JobTrack</h1>
          <p className="mt-2 text-gray-500">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, don't render anything (redirect will happen in useEffect)
  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Bar */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex overflow-x-auto whitespace-nowrap items-center space-x-4 sm:space-x-6">
              <Link href="/dashboard">
                <span className="font-bold text-lg sm:text-xl text-blue-600">JobTrack</span>
              </Link>
              {[
                { href: '/dashboard/jobs', label: 'Job Board' },
                { href: '/dashboard/add', label: 'Add Job' },
                { href: '/dashboard/upload', label: 'Uploads' },
                { href: '/dashboard/pending', label: 'Pending' },
                { href: '/dashboard/mail', label: 'Mail' },
                { href: '/dashboard', label: 'Dashboard' },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm sm:text-base font-medium ${
                    pathname === item.href
                      ? 'border-blue-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="flex items-center">
              <div className="hidden sm:flex-shrink-0 sm:flex">
                <span className="inline-flex items-center px-3 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  {session?.user?.name || session?.user?.email}
                </span>
              </div>
              <div className="ml-2 sm:ml-4">
                <button
                  type="button"
                  className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100"
                  onClick={() => {
                    signOut({ callbackUrl: '/login' });
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-4 sm:px-0">
          {children}
        </div>
      </main>
    </div>
  );
}
