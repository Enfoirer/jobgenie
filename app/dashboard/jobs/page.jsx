// app/dashboard/jobs/page.jsx
'use client';

import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { mockJobs, COLUMNS, COLUMN_NAMES } from '@/lib/mockData';

export default function JobsPage() {
  const [jobsData, setJobsData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API call with mock data
    setTimeout(() => {
      setJobsData(mockJobs);
      setLoading(false);
    }, 800);
  }, []);

  const handleDragEnd = (result) => {
    const { destination, source, draggableId } = result;

    // If dropped outside a droppable area
    if (!destination) return;

    // If dropped in the same position
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) return;

    // Find the job being dragged
    const job = jobsData.jobs.find(job => job.id === draggableId);
    
    // Update its status
    const updatedJobs = jobsData.jobs.map(j => 
      j.id === draggableId ? { ...j, status: destination.droppableId } : j
    );

    // Update state
    setJobsData({ jobs: updatedJobs });

    // In a real app, you would make an API call to update the job status
    console.log(`Job ${job.id} moved from ${source.droppableId} to ${destination.droppableId}`);
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
                      <Draggable key={job.id} draggableId={job.id} index={index}>
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
                                onClick={() => {
                                  // In a real app, navigate to edit form
                                  console.log(`Edit job ${job.id}`);
                                }}
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                Edit
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