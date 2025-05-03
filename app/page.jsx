// app/page.jsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // In a real app, you would check if the user is authenticated
    const isAuthenticated = false; // This would be from your auth context

    if (isAuthenticated) {
      router.push('/dashboard/jobs');
    } else {
      router.push('/login');
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <h1 className="mt-6 text-xl font-semibold text-gray-700">JobTrack</h1>
        <p className="mt-2 text-gray-500">Loading your application...</p>
      </div>
    </div>
  );
}