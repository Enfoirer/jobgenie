// app/dashboard/jobs/page.jsx
'use client';

import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { COLUMNS, COLUMN_NAMES } from '@/lib/mockData';

export default function JobsPage() {
  const [jobsData, setJobsData] = useState({ jobs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Fetch jobs from API
    const fetchJobs = async () => {
      try {
        const response = await fetch('/api/jobs');
        
        if (!response.ok) {
          throw new Error('Failed to fetch jobs');
        }
        
        const data = await response.json();
        setJobsData(data);
      } catch (error) {
        console.error('Error fetching jobs:', error);
        setError('Failed to load your job applications. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
  }, []);

  const handleDragEnd = async (result) => {
    const { destination, source, draggableId } = result;

    // If dropped outside a droppable area
    if (!destination) return;

    // If dropped in the same position
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) return;

    // Find the job being dragged
    const job = jobsData.jobs.find(job => job._id === draggableId);
    
    if (!job) return;
    
    // Update its status locally first (optimistic update)
    const updatedJobs = jobsData.jobs.map(j => 
      j._id === draggableId ? { ...j, status: destination.droppableId } : j
    );

    // Update state
    setJobsData({ jobs: updatedJobs });

    // Update in the database
    try {
      const response = await fetch(`/api/jobs/${draggableId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: destination.droppableId }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update job status');
        // If there's an error, you might want to revert the optimistic update
      }
    } catch (error) {
      console.error('Error updating job status:', error);
      // Revert the optimistic update on error
      setJobsData({ jobs: jobsData.jobs });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your job applications...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-red-500 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <p className="text-gray-800 font-medium">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Group jobs by status
  const columns = {
    [COLUMNS.APPLIED]: jobsData.jobs.filter(job => job.status === COLUMNS.APPLIED),
    [COLUMNS.INTERVIEWING]: jobsData.jobs.filter(job => job.status === COLUMNS.INTERVIEWING),
    [COLUMNS.COMPLETED]: jobsData.jobs.filter(job => job.status === COLUMNS.COMPLETED),
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-2xl font-semibold text-gray-800">Job Applications</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track your applications across different stages
        </p>
      </div>
      
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Object.keys(columns).map(columnId => (
            <div key={columnId} className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-800">{COLUMN_NAMES[columnId]}</h2>
                <p className="text-sm text-gray-500">{columns[columnId].length} applications</p>
              </div>
              
              <Droppable droppableId={columnId}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`p-4 min-h-80 ${
                      snapshot.isDraggingOver ? 'bg-blue-50' : ''
                    }`}
                  >
                    {columns[columnId].map((job, index) => (
                      <Draggable key={job._id} draggableId={job._id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`bg-white rounded-lg border ${
                              snapshot.isDragging ? 'shadow-lg border-blue-300' : 'border-gray-200'
                            } p-4 mb-3`}
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-medium text-gray-800">{job.company}</h3>
                                <p className="text-sm text-gray-600">{job.position}</p>
                                <p className="text-xs text-gray-500 mt-1">{job.location}</p>
                              </div>
                              <div>
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  {job.applicationSource}
                                </span>
                              </div>
                            </div>
                            
                            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                              <p className="text-xs text-gray-500">Applied: {new Date(job.dateApplied).toLocaleDateString()}</p>
                              <button 
                                onClick={async () => {
                                  // Delete the job
                                  if (confirm('Are you sure you want to delete this job application?')) {
                                    try {
                                      const response = await fetch(`/api/jobs/${job._id}`, {
                                        method: 'DELETE'
                                      });
                                      
                                      if (response.ok) {
                                        // Remove the job from state
                                        setJobsData({ 
                                          jobs: jobsData.jobs.filter(j => j._id !== job._id) 
                                        });
                                      } else {
                                        throw new Error('Failed to delete job');
                                      }
                                    } catch (error) {
                                      console.error('Error deleting job:', error);
                                      alert('Failed to delete job. Please try again.');
                                    }
                                  }
                                }}
                                className="text-xs text-red-600 hover:text-red-800"
                              >
                                Delete
                              </button>
                            </div>
                            
                            {job.notes && (
                              <div className="mt-2 text-xs text-gray-600 bg-gray-50 p-2 rounded">
                                {job.notes}
                              </div>
                            )}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}