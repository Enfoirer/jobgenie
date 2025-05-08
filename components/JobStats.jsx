'use client';

import { useState, useEffect } from 'react';
import { COLUMNS } from '@/lib/mockData';

export default function JobStats() {
  const [stats, setStats] = useState({
    total: 0,
    applied: 0,
    interviewing: 0,
    offered: 0,
    rejected: 0,
    averageResponseTime: 0,
    interviewRate: 0,
    offerRate: 0,
    mostCommonSource: ''
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchJobStats = async () => {
      try {
        setLoading(true);
        
        // Fetch all jobs
        const response = await fetch('/api/jobs');
        if (!response.ok) {
          throw new Error('Failed to fetch jobs');
        }
        
        const data = await response.json();
        if (!data || !data.jobs) {
          return;
        }
        
        const jobs = data.jobs;
        
        // Basic counts
        const total = jobs.length;
        const applied = jobs.filter(job => job.status === COLUMNS.APPLIED).length;
        const interviewing = jobs.filter(job => job.status === COLUMNS.INTERVIEWING).length;
        const offered = jobs.filter(job => job.status === COLUMNS.OFFER).length;
        const rejected = jobs.filter(job => job.status === COLUMNS.REJECTED).length;
        
        // Interview rate = (interviews + offers + rejections) / total
        const interviewRate = total > 0 ? 
          ((interviewing + offered + rejected) / total) * 100 : 0;
        
        // Offer rate = offers / (interviews + offers + rejections)
        const offerRate = (interviewing + offered + rejected) > 0 ? 
          (offered / (interviewing + offered + rejected)) * 100 : 0;
        
        // Find most common application source
        const sourceCount = {};
        jobs.forEach(job => {
          if (job.applicationSource) {
            sourceCount[job.applicationSource] = (sourceCount[job.applicationSource] || 0) + 1;
          }
        });
        
        let mostCommonSource = '';
        let maxCount = 0;
        
        Object.entries(sourceCount).forEach(([source, count]) => {
          if (count > maxCount) {
            mostCommonSource = source;
            maxCount = count;
          }
        });
        
        setStats({
          total,
          applied,
          interviewing,
          offered,
          rejected,
          interviewRate,
          offerRate,
          mostCommonSource
        });
      } catch (error) {
        console.error('Error fetching job stats:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchJobStats();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="h-20 bg-gray-200 rounded"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-800">Job Application Statistics</h2>
      </div>
      
      <div className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
            <div className="text-sm text-gray-500">Total Applications</div>
            <div className="text-2xl font-semibold text-blue-600">{stats.total}</div>
          </div>
          
          <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-100">
            <div className="text-sm text-gray-500">In Progress</div>
            <div className="text-2xl font-semibold text-yellow-600">
              {stats.interviewing}
              <span className="text-sm font-normal text-gray-500 ml-2">
                ({stats.interviewRate.toFixed(0)}%)
              </span>
            </div>
          </div>
          
          <div className="bg-green-50 p-4 rounded-lg border border-green-100">
            <div className="text-sm text-gray-500">Offers</div>
            <div className="text-2xl font-semibold text-green-600">
              {stats.offered}
              <span className="text-sm font-normal text-gray-500 ml-2">
                ({stats.offerRate.toFixed(0)}%)
              </span>
            </div>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-500">Top Source</div>
            <div className="text-xl font-semibold text-gray-700">{stats.mostCommonSource || '-'}</div>
          </div>
        </div>
        
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4">
          {/* Status breakdown */}
          <div className="sm:col-span-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-700 mb-3">Status Breakdown</div>
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                {/* Applied - Blue */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Applied</span>
                    <span>{stats.applied} ({stats.total > 0 ? ((stats.applied / stats.total) * 100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${stats.total > 0 ? (stats.applied / stats.total) * 100 : 0}%` }}></div>
                  </div>
                </div>
                
                {/* Interviewing - Yellow */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Interviewing</span>
                    <span>{stats.interviewing} ({stats.total > 0 ? ((stats.interviewing / stats.total) * 100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-yellow-500 h-2 rounded-full" style={{ width: `${stats.total > 0 ? (stats.interviewing / stats.total) * 100 : 0}%` }}></div>
                  </div>
                </div>
                
                {/* Offered - Green */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Offers</span>
                    <span>{stats.offered} ({stats.total > 0 ? ((stats.offered / stats.total) * 100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{ width: `${stats.total > 0 ? (stats.offered / stats.total) * 100 : 0}%` }}></div>
                  </div>
                </div>
                
                {/* Rejected - Gray */}
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Rejected</span>
                    <span>{stats.rejected} ({stats.total > 0 ? ((stats.rejected / stats.total) * 100).toFixed(0) : 0}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-gray-400 h-2 rounded-full" style={{ width: `${stats.total > 0 ? (stats.rejected / stats.total) * 100 : 0}%` }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}