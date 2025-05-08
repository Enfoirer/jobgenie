'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { COLUMNS, COLUMN_NAMES } from '@/lib/mockData';

// Constants for status colors
const STATUS_COLORS = {
  applied: '#3B82F6',    // Blue
  interviewing: '#F59E0B', // Orange
  offer: '#10B981',      // Green
  rejected: '#9CA3AF'    // Grey
};

export default function JobAnalytics() {
  const [jobsData, setJobsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hideRejected, setHideRejected] = useState(false);
  const [statusCounts, setStatusCounts] = useState({});
  const [monthlyData, setMonthlyData] = useState([]);
  const [timelineData, setTimelineData] = useState([]);

  useEffect(() => {
    // Fetch jobs from API
    const fetchJobs = async () => {
      try {
        console.log('Fetching jobs for analytics');
        setLoading(true);
        
        const response = await fetch('/api/jobs');
        
        if (!response.ok) {
          throw new Error('Failed to fetch jobs');
        }
        
        const data = await response.json();
        console.log('Received jobs for analytics:', data);
        
        if (data.jobs && data.jobs.length > 0) {
          // Process the jobs data
          processJobsData(data.jobs);
          setJobsData(data.jobs);
        }
      } catch (error) {
        console.error('Error fetching jobs for analytics:', error);
        setError('Failed to load job data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
  }, []);

  // Process jobs data for various visualizations
  const processJobsData = (jobs) => {
    // 1. Count by status
    const counts = jobs.reduce((acc, job) => {
      const status = job.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    setStatusCounts(counts);
    
    // 2. Process timeline data (jobs sorted by application date)
    const sortedJobs = [...jobs].sort((a, b) => 
      new Date(a.dateApplied) - new Date(b.dateApplied)
    );
    
    // Create a mapped timeline data with points for each status
    const timeline = sortedJobs.map(job => {
      const date = new Date(job.dateApplied);
      return {
        id: job._id,
        company: job.company,
        position: job.position,
        date: `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`,
        timestamp: date.getTime(),
        status: job.status,
        location: job.location
      };
    });
    setTimelineData(timeline);
    
    // 3. Group by month for trend analysis
    const months = {};
    
    jobs.forEach(job => {
      if (!job.dateApplied) return;
      
      const date = new Date(job.dateApplied);
      const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
      
      if (!months[monthKey]) {
        months[monthKey] = {
          name: `${date.getMonth() + 1}/${date.getFullYear()}`,
          timestamp: date.getTime(),
          applied: 0,
          interviewing: 0,
          offer: 0,
          rejected: 0,
          total: 0
        };
      }
      
      // Increment the count for the job's status
      if (job.status) {
        months[monthKey][job.status] += 1;
        months[monthKey].total += 1;
      }
    });
    
    // Convert to array and sort by date
    const monthsArray = Object.values(months)
      .sort((a, b) => a.timestamp - b.timestamp);
    
    setMonthlyData(monthsArray);
  };

  // Handle the "hide rejected" filter change
  useEffect(() => {
    if (jobsData.length === 0) return;
    
    // Filter out rejected jobs if necessary
    const filteredJobs = hideRejected 
      ? jobsData.filter(job => job.status !== COLUMNS.REJECTED)
      : jobsData;
    
    // Reprocess the filtered jobs
    processJobsData(filteredJobs);
  }, [hideRejected, jobsData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-l-4 border-red-400 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (jobsData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center">
        <p className="text-gray-500">No job applications found to analyze</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex justify-end">
        <label className="flex items-center space-x-2 text-sm text-gray-700">
          <input 
            type="checkbox" 
            checked={hideRejected} 
            onChange={() => setHideRejected(!hideRejected)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Hide rejected applications</span>
        </label>
      </div>
      
      {/* Status Distribution */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-800">Application Status Distribution</h2>
        </div>
        <div className="p-4">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  {
                    name: 'Status',
                    Applied: statusCounts.applied || 0,
                    Interviewing: statusCounts.interviewing || 0,
                    Offers: statusCounts.offer || 0,
                    ...(hideRejected ? {} : { Rejected: statusCounts.rejected || 0 })
                  }
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Applied" fill={STATUS_COLORS.applied} />
                <Bar dataKey="Interviewing" fill={STATUS_COLORS.interviewing} />
                <Bar dataKey="Offers" fill={STATUS_COLORS.offer} />
                {!hideRejected && <Bar dataKey="Rejected" fill={STATUS_COLORS.rejected} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
      {/* Monthly Trend */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-800">Monthly Application Trend</h2>
        </div>
        <div className="p-4">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="applied" stackId="a" fill={STATUS_COLORS.applied} name="Applied" />
                <Bar dataKey="interviewing" stackId="a" fill={STATUS_COLORS.interviewing} name="Interviewing" />
                <Bar dataKey="offer" stackId="a" fill={STATUS_COLORS.offer} name="Offer" />
                {!hideRejected && (
                  <Bar dataKey="rejected" stackId="a" fill={STATUS_COLORS.rejected} name="Rejected" />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
      {/* Application Timeline */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-800">Application Timeline</h2>
          <p className="text-sm text-gray-500">Showing all jobs by application date</p>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <div className="flex space-x-4">
              <div className="flex items-center">
                <span className="inline-block w-3 h-3 bg-blue-500 rounded-full mr-1"></span>
                <span className="text-xs text-gray-600 mr-2">Applied</span>
              </div>
              <div className="flex items-center">
                <span className="inline-block w-3 h-3 bg-yellow-500 rounded-full mr-1"></span>
                <span className="text-xs text-gray-600 mr-2">Interviewing</span>
              </div>
              <div className="flex items-center">
                <span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-1"></span>
                <span className="text-xs text-gray-600 mr-2">Offer</span>
              </div>
              {!hideRejected && (
                <div className="flex items-center">
                  <span className="inline-block w-3 h-3 bg-gray-400 rounded-full mr-1"></span>
                  <span className="text-xs text-gray-600">Rejected</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Timeline visualization */}
          <div className="overflow-x-auto max-h-96 scrollbar-thin">
            <div className="min-w-max">
              <div className="relative">
                {/* Horizontal axis line */}
                <div className="absolute left-0 right-0 h-0.5 bg-gray-300 top-8"></div>
                
                {/* Timeline content */}
                <div className="py-16">
                  {timelineData.map((job, index) => (
                    <div key={job.id} className="relative" style={{ 
                      marginLeft: `${index * 120}px`, 
                      display: 'inline-block',
                      marginRight: '20px'
                    }}>
                      {/* Status dot */}
                      <div className={`absolute w-4 h-4 rounded-full border-2 border-white shadow-md ${
                        job.status === COLUMNS.APPLIED 
                          ? 'bg-blue-500' 
                          : job.status === COLUMNS.INTERVIEWING 
                            ? 'bg-yellow-500' 
                            : job.status === COLUMNS.OFFER 
                              ? 'bg-green-500' 
                              : 'bg-gray-400'
                      }`} style={{ top: '-8px' }}></div>
                      
                      {/* Company name */}
                      <div className="mt-4 transform -rotate-45 origin-top-left">
                        <div className="bg-white text-xs font-medium p-1 border border-gray-200 shadow-sm rounded">
                          {job.company}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {job.date}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}