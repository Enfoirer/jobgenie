// components/JobTimeline.jsx
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

  return (
    <div className="fixed inset-0 overflow-y-auto z-50">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity">
          <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
        </div>
        
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen"></span>&#8203;
        
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  {job ? `${job.company} - ${job.position}` : 'Job Application'} Timeline
                </h3>
                
                {error && (
                  <div className="mt-2 rounded-md bg-red-50 p-2">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}
                
                {loading ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
                      <p className="mt-3 text-gray-600">Loading timeline...</p>
                    </div>
                  </div>
                ) : statusHistory.length === 0 ? (
                  <div className="text-center py-10">
                    <p className="text-gray-500">No status history available yet.</p>
                    <p className="text-gray-500 text-sm mt-2">Update the job status to start building a timeline.</p>
                  </div>
                ) : (
                  <div className="mt-4 timeline-container">
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
                              {COLUMN_NAMES[entry.status]}
                              {entry.interviewStage && (
                                <span className="ml-2 text-sm text-gray-500">
                                  - {entry.interviewStage}
                                </span>
                              )}
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
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={onClose}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}