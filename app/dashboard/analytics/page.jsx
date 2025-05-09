// app/dashboard/analytics/page.jsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import JobStats from '@/components/JobStats';

// Import the JobApplicationTimeline component dynamically to avoid SSR issues with charts
const JobApplicationTimeline = dynamic(() => import('@/components/JobApplicationTimeline'), { 
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading timeline...</p>
      </div>
    </div>
  )
});

export default function AnalyticsPage() {
  const [hideRejected, setHideRejected] = useState(false);

  const handleToggleRejected = () => {
    setHideRejected(!hideRejected);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Job Application Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track the progression of your job applications
          </p>
        </div>
      </div>
      
      {/* Job Stats */}
      <JobStats />
      
      {/* Job Application Timeline - The main visualization */}
      <div className="mt-6">
        <JobApplicationTimeline 
          hideRejected={hideRejected} 
          onToggleRejected={handleToggleRejected} 
        />
      </div>
    </div>
  );
}