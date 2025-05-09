// components/JobTimeline.jsx
// This is the simpler timeline component for job cards

'use client';

import { useState, useEffect } from 'react';
import { COLUMN_NAMES } from '@/lib/mockData';

export default function JobTimeline({ jobId, onClose }) {
  const [statusHistory, setStatusHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [job, setJob] = useState(null);

  useEffect(() => {
    const fetchJobAndHistory = async () => {
      try {
        console.log(`Fetching job and status history for job ${jobId}`);
        setLoading(true);
        
        // Fetch the job first to get details
        const jobResponse = await fetch(`/api/jobs/${jobId}`);
        if (!jobResponse.ok) {
          throw new Error('Failed to fetch job details');
        }
        const jobData = await jobResponse.json();
        setJob(jobData.job);
        
        // Then fetch status history
        const historyResponse = await fetch(`/api/jobs/${jobId}/status-history`);
        if (!historyResponse.ok) {
          throw new Error('Failed to fetch status history');
        }
        
        const historyData = await historyResponse.json();
        console.log('Received status history:', historyData);
        
        // Sort the history by date
        const sortedHistory = [...historyData.statusHistory].sort((a, b) => 
          new Date(a.date) - new Date(b.date)
        );
        
        setStatusHistory(sortedHistory);
      } catch (error) {
        console.error('Error fetching job data:', error);
        setError('Failed to load job data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchJobAndHistory();
  }, [jobId]);

  // Get CSS class for timeline dot based on status
  const getStatusDotClass = (status) => {
    switch(status) {
      case 'applied':
        return 'timeline-dot-applied';
      case 'interviewing':
        return 'timeline-dot-interviewing';
      case 'offer':
        return 'bg-green-500 border-4 border-white shadow';
      case 'rejected':
        return 'bg-red-500 border-4 border-white shadow';
      default:
        return 'bg-gray-500 border-4 border-white shadow';
    }
  };

  // Format date to MM/DD/YYYY
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  };

  // Get status display name - Enhanced to include interview stage
  const getStatusDisplayName = (entry) => {
    const baseName = COLUMN_NAMES[entry.status];
    
    // If it's an interview status and has an interview stage, include it
    if (entry.status === 'interviewing' && entry.interviewStage) {
      return `${baseName} - ${entry.interviewStage}`;
    }
    
    return baseName;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-3 text-gray-600">Loading timeline...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 rounded-md bg-red-50 p-2">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
        {job ? `${job.company} - ${job.position}` : 'Job Application'} Timeline
      </h3>
      
      {statusHistory.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-gray-500">No status history available yet.</p>
          <p className="text-gray-500 text-sm mt-2">Update the job status to start building a timeline.</p>
        </div>
      ) : (
        <div className="timeline-container">
          {/* Timeline line */}
          <div className="timeline-line"></div>
          
          {/* Timeline events */}
          <div className="space-y-4">
            {statusHistory.map((entry, index) => (
              <div key={entry._id || index} className="timeline-item">
                {/* Timeline dot */}
                <div className={`timeline-dot ${getStatusDotClass(entry.status)}`}></div>
                
                {/* Timeline content */}
                <div className="timeline-content">
                  <div className="timeline-title">
                    {getStatusDisplayName(entry)}
                  </div>
                  <div className="timeline-date">{formatDate(entry.date)}</div>
                  {entry.notes && (
                    <div className="timeline-notes">
                      {entry.notes}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="mt-6 text-right">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}