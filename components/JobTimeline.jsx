'use client';

import { useState, useEffect, useRef } from 'react';
import { COLUMNS, COLUMN_NAMES } from '@/lib/mockData';

export default function JobApplicationTimeline({ hideRejected = false, onToggleRejected }) {
  const [jobsData, setJobsData] = useState([]);
  const [jobHistories, setJobHistories] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [globalTimeRange, setGlobalTimeRange] = useState({ start: null, end: null });
  const [visibleTimeRange, setVisibleTimeRange] = useState({ start: null, end: null });
  const [scrollPosition, setScrollPosition] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100); // 100% = full range
  const containerRef = useRef(null);
  const timelineContainerRef = useRef(null);

  // Detect window resize to adjust for mobile view
  useEffect(() => {
    const handleResize = () => {
      // Recalculate visible time range to adjust for screen size changes
      if (globalTimeRange.start && globalTimeRange.end) {
        updateVisibleTimeRange(scrollPosition, zoomLevel);
      }
    };
    
    // Add resize listener
    window.addEventListener('resize', handleResize);
    
    // Clean up
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [globalTimeRange, scrollPosition, zoomLevel]);

  useEffect(() => {
    const fetchJobs = async () => {
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
        
        // Sort jobs by application date
        const sortedJobs = [...data.jobs].sort((a, b) => 
          new Date(a.dateApplied) - new Date(b.dateApplied)
        );
        
        setJobsData(sortedJobs);
        
        // Fetch status history for each job
        const histories = {};
        let earliestDate = new Date();
        let latestDate = new Date(0); // Jan 1, 1970
        
        for (const job of sortedJobs) {
          try {
            const historyResponse = await fetch(`/api/jobs/${job._id}/status-history`);
            if (historyResponse.ok) {
              const historyData = await historyResponse.json();
              if (historyData.statusHistory) {
                // Sort by date
                const sortedHistory = [...historyData.statusHistory].sort((a, b) => 
                  new Date(a.date) - new Date(b.date)
                );
                histories[job._id] = sortedHistory;
                
                // Update global time range
                sortedHistory.forEach(event => {
                  const eventDate = new Date(event.date);
                  if (eventDate < earliestDate) {
                    earliestDate = eventDate;
                  }
                  if (eventDate > latestDate) {
                    latestDate = eventDate;
                  }
                });
              }
            }
          } catch (err) {
            console.error(`Failed to fetch history for job ${job._id}:`, err);
          }
        }
        
        // Also include application dates in the time range
        sortedJobs.forEach(job => {
          const appDate = new Date(job.dateApplied);
          if (appDate < earliestDate) {
            earliestDate = appDate;
          }
          if (appDate > latestDate) {
            latestDate = appDate;
          }
        });
        
        // Add 10% padding to the time range
        const timeSpan = latestDate - earliestDate;
        earliestDate = new Date(earliestDate.getTime() - (timeSpan * 0.1));
        latestDate = new Date(latestDate.getTime() + (timeSpan * 0.1));
        
        // Set both global and visible time ranges initially
        setGlobalTimeRange({ start: earliestDate, end: latestDate });
        setVisibleTimeRange({ start: earliestDate, end: latestDate });
        setJobHistories(histories);
      } catch (error) {
        console.error('Error fetching jobs:', error);
        setError('Failed to load job data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchJobs();
  }, []);

  // Handle time range navigation (horizontal scrolling)
  const handleTimeSliderChange = (e) => {
    if (!globalTimeRange.start || !globalTimeRange.end) return;
    
    const newPosition = parseInt(e.target.value);
    setScrollPosition(newPosition);
    
    // Calculate visible time range based on scroll position and zoom level
    updateVisibleTimeRange(newPosition, zoomLevel);
  };

  // Handle zoom level change
  const handleZoomChange = (e) => {
    const newZoom = parseInt(e.target.value);
    setZoomLevel(newZoom);
    
    // Update visible time range with new zoom level
    updateVisibleTimeRange(scrollPosition, newZoom);
  };

  // Update visible time range based on scroll position and zoom level
  const updateVisibleTimeRange = (position, zoom) => {
    if (!globalTimeRange.start || !globalTimeRange.end) return;
    
    const totalTimeSpan = globalTimeRange.end - globalTimeRange.start;
    
    // Calculate visible window size based on zoom (smaller zoom = wider time range)
    const visibleSpan = totalTimeSpan * (100 / zoom);
    
    // Calculate start position based on scroll position (0-100)
    const maxScrollableTimeSpan = totalTimeSpan - visibleSpan;
    const startOffset = (maxScrollableTimeSpan * position) / 100;
    
    // Calculate new start and end dates
    const newStart = new Date(globalTimeRange.start.getTime() + startOffset);
    const newEnd = new Date(newStart.getTime() + visibleSpan);
    
    setVisibleTimeRange({ start: newStart, end: newEnd });
  };

  // Format date as MM/DD/YYYY
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  };

  // Get horizontal position based on date and visible time range
  const getPositionForDate = (dateString) => {
    if (!visibleTimeRange.start || !visibleTimeRange.end) return 0;
    
    const date = new Date(dateString);
    const totalVisibleSpan = visibleTimeRange.end - visibleTimeRange.start;
    
    // If outside the visible range, clamp to edges
    if (date < visibleTimeRange.start) return 0;
    if (date > visibleTimeRange.end) return 100;
    
    const datePosition = date - visibleTimeRange.start;
    
    // Return percentage position (0-100)
    return (datePosition / totalVisibleSpan) * 100;
  };
  
  // Check if nodes are too close together based on zoom level and dates
  const areNodesTooClose = (date1, date2) => {
    if (!visibleTimeRange.start || !visibleTimeRange.end) return false;
    
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const totalVisibleSpan = visibleTimeRange.end - visibleTimeRange.start;
    
    // Calculate how close the nodes are as a percentage of the visible timeline
    const dateDistance = Math.abs(d1 - d2);
    const distancePercentage = (dateDistance / totalVisibleSpan) * 100;
    
    // Determine if too close based on zoom level - the wider the view (lower zoom),
    // the more space needed between nodes to show labels
    const minimumDistance = 200 / zoomLevel; // Adjust threshold based on zoom
    
    return distancePercentage < minimumDistance;
  };

  // Check if a date is within the visible time range
  const isDateVisible = (dateString) => {
    if (!visibleTimeRange.start || !visibleTimeRange.end) return true;
    
    const date = new Date(dateString);
    return date >= visibleTimeRange.start && date <= visibleTimeRange.end;
  };
  
  // Check if a job has ANY visible events in the time range
  const hasAnyVisibleEvents = (job, history) => {
    // Always show jobs regardless of time range - modified to fix the bug
    return true;
    
    // Previous logic removed:
    // Check application date
    // if (isDateVisible(job.dateApplied)) return true;
    
    // Check any status history events
    // if (history && history.length > 0) {
    //   return history.some(event => isDateVisible(event.date));
    // }
    
    // return false;
  };

  // Get status color for nodes
  const getStatusNodeColor = (status) => {
    switch (status) {
      case COLUMNS.APPLIED:
        return 'bg-blue-500 border-blue-600'; // Blue
      case COLUMNS.INTERVIEWING:
        return 'bg-yellow-500 border-yellow-600'; // Orange/Yellow
      case COLUMNS.OFFER:
        return 'bg-green-500 border-green-600'; // Green
      case COLUMNS.REJECTED:
        return 'bg-red-500 border-red-600'; // Red
      default:
        return 'bg-gray-300 border-gray-400';
    }
  };

  // Get status color for lines
  const getStatusLineColor = (status) => {
    switch (status) {
      case COLUMNS.APPLIED:
        return 'bg-blue-500'; // Blue
      case COLUMNS.INTERVIEWING:
        return 'bg-yellow-500'; // Orange/Yellow
      case COLUMNS.OFFER:
        return 'bg-green-500'; // Green
      case COLUMNS.REJECTED:
        return 'bg-gray-400'; // Grey
      default:
        return 'bg-gray-300';
    }
  };

  // Filter jobs if hideRejected is true
  const filteredJobs = hideRejected 
    ? jobsData.filter(job => job.status !== COLUMNS.REJECTED)
    : jobsData;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading timelines...</p>
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

  if (filteredJobs.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center">
        <p className="text-gray-500">No job applications found for timeline</p>
        {hideRejected && jobsData.length > 0 && (
          <p className="text-gray-500 text-sm mt-2">
            Try disabling the "Hide rejected applications" filter
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow" ref={containerRef}>
      <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-lg font-medium text-gray-800">Application Timelines</h2>
        <div className="flex items-center">
        <label className="flex items-center space-x-2 text-sm text-gray-700">
          <input 
            type="checkbox" 
            checked={hideRejected} 
            onChange={() => typeof onToggleRejected === 'function' ? onToggleRejected() : setHideRejected(!hideRejected)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Hide rejected applications</span>
        </label>
        </div>
      </div>
      
      <div className="p-4">
        <div className="flex justify-start items-center mb-4">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <div className="flex items-center">
              <span className="inline-block w-3 h-3 bg-blue-500 rounded-full mr-1"></span>
              <span className="text-xs text-gray-600">Applied</span>
            </div>
            <div className="flex items-center">
              <span className="inline-block w-3 h-3 bg-yellow-500 rounded-full mr-1"></span>
              <span className="text-xs text-gray-600">Interviewing</span>
            </div>
            <div className="flex items-center">
              <span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-1"></span>
              <span className="text-xs text-gray-600">Offer</span>
            </div>
            <div className="flex items-center">
              <span className="inline-block w-3 h-3 bg-red-500 rounded-full mr-1"></span>
              <span className="text-xs text-gray-600">Rejected</span>
            </div>
            <div className="flex items-center ml-4 pl-4 border-l border-gray-300">
              <span className="text-xs text-gray-600 font-medium">Timeline color shows current status</span>
            </div>
          </div>
        </div>
        
        {/* Time controls */}
        <div className="mb-6 px-4 sm:px-[200px]">
          {/* Date scale at the top */}
          <div className="relative h-6 mb-1 border-b border-gray-200">
            {/* Date markers */}
            {(() => {
              if (!visibleTimeRange.start || !visibleTimeRange.end) return null;
              
              const markers = [];
              const totalDays = Math.ceil((visibleTimeRange.end - visibleTimeRange.start) / (1000 * 60 * 60 * 24));
              
              // Adjust number of markers based on screen size and zoom level
              const isMobile = window.innerWidth < 640; // Check for mobile
              const increment = isMobile 
                ? Math.max(14, Math.ceil(totalDays / 4)) // Fewer markers on mobile
                : Math.max(7, Math.ceil(totalDays / 8)); // More on desktop
              
              // Calculate start point aligned to nearest week
              const startDate = new Date(visibleTimeRange.start);
              startDate.setDate(startDate.getDate() - startDate.getDay()); // Align to previous Sunday
              
              for (let i = 0; i <= totalDays + 7; i += increment) {
                const date = new Date(startDate);
                date.setDate(date.getDate() + i);
                
                // Skip if outside the visible range
                if (date < visibleTimeRange.start || date > visibleTimeRange.end) continue;
                
                const position = getPositionForDate(date);
                
                markers.push(
                  <div 
                    key={i} 
                    className="absolute bottom-0 transform -translate-x-1/2"
                    style={{ left: `${position}%` }}
                  >
                    <div className="h-2 w-0.5 bg-gray-300"></div>
                    <div className="absolute bottom-2 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(date)}
                    </div>
                  </div>
                );
              }
              
              return markers;
            })()}
          </div>
          
          {/* Zoom and Range Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center mb-2 gap-2">
            <div className="flex items-center">
              <span className="text-xs text-gray-500 mr-2">Time Scale:</span>
              <span className="text-xs text-gray-500 mr-2">Narrow</span>
              <input
                type="range"
                min="10"
                max="200"
                value={zoomLevel}
                onChange={handleZoomChange}
                className="w-32 sm:w-48 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs text-gray-500 ml-2">Wide</span>
            </div>
            <div className="text-xs text-gray-500">
              Viewing: {visibleTimeRange.start ? formatDate(visibleTimeRange.start) : 'Start'} — {visibleTimeRange.end ? formatDate(visibleTimeRange.end) : 'End'}
            </div>
          </div>
          
          {/* Time Slider */}
          <input
            type="range"
            min="0"
            max="100"
            value={scrollPosition}
            onChange={handleTimeSliderChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{globalTimeRange.start ? formatDate(globalTimeRange.start) : 'Start'}</span>
            <span>{globalTimeRange.end ? formatDate(globalTimeRange.end) : 'End'}</span>
          </div>
        </div>
        
                  {/* Job Timelines */}
        <div 
          ref={timelineContainerRef}
          className="overflow-y-auto max-h-[60vh] sm:max-h-[60vh] scrollbar-thin"
        >
          {filteredJobs.map((job) => {
            // Get the status history for this job
            const history = jobHistories[job._id] || [];
            
            // If no history, create a default one based on application date
            const timelineEvents = history.length > 0 ? history : [
              {
                _id: 'default',
                status: job.status,
                date: job.dateApplied,
                notes: 'Application submitted'
              }
            ];
            
            // Get current status (last in timeline or job status)
            const currentStatus = timelineEvents.length > 0 
              ? timelineEvents[timelineEvents.length - 1].status 
              : job.status;
            
            // Check if at least one event is visible in the current time range
            const hasVisibleEvents = hasAnyVisibleEvents(job, timelineEvents);
            
            // Never skip jobs with no visible events - modified to fix the bug
            // if (!hasVisibleEvents) return null;
            
            return (
              <div key={job._id} className="mb-3 bg-gray-50 rounded-lg shadow-sm">
                {/* Job header with company and position */}
                <div className="flex justify-between items-center p-2 bg-gray-100 rounded-t-lg">
                  <div className="flex-grow overflow-hidden">
                    <div className="flex items-baseline">
                      <h3 className="text-sm font-medium text-gray-800 mr-2 truncate">{job.company}</h3>
                      <p className="text-xs text-gray-600 truncate">· {job.position}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 ml-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      job.status === COLUMNS.APPLIED 
                        ? 'bg-blue-100 text-blue-800' 
                        : job.status === COLUMNS.INTERVIEWING 
                          ? 'bg-yellow-100 text-yellow-800' 
                          : job.status === COLUMNS.OFFER 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-gray-100 text-gray-800'
                    }`}>
                      {COLUMN_NAMES[job.status]}
                    </span>
                  </div>
                </div>
                
                {/* Timeline */}
                <div className="flex p-2">
                  {/* Minimal job info */}
                  <div className="w-[130px] sm:w-[160px] flex-shrink-0 pr-2">
                    <div className="text-xs text-gray-500">
                      Applied: {formatDate(job.dateApplied)}
                    </div>
                    <div className="text-xs text-gray-500">
                      Source: {job.applicationSource || 'Not specified'}
                    </div>
                  </div>
                  
                  {/* Timeline with proportional dates */}
                  <div className="relative flex-grow h-10 mt-0">
                    {/* The timeline line */}
                    <div className={`absolute left-0 right-0 h-1 top-1/2 transform -translate-y-1/2 ${getStatusLineColor(currentStatus)}`}></div>
                    
                    {/* Timeline points positioned by actual dates */}
                    {timelineEvents.map((event, index) => {
                      // Skip if outside visible range
                      if (!isDateVisible(event.date)) return null;
                      
                      const position = getPositionForDate(event.date);
                      const isEven = index % 2 === 0;
                      
                      // Check if this node is too close to its neighbors to show label
                      const prevEvent = index > 0 ? timelineEvents[index - 1] : null;
                      const nextEvent = index < timelineEvents.length - 1 ? timelineEvents[index + 1] : null;
                      
                      const tooCloseToPrev = prevEvent && isDateVisible(prevEvent.date) && areNodesTooClose(event.date, prevEvent.date);
                      const tooCloseToNext = nextEvent && isDateVisible(nextEvent.date) && areNodesTooClose(event.date, nextEvent.date);
                      
                      // Only show label if not too crowded and zoom level is sufficient
                      const showLabel = zoomLevel > 50 && !tooCloseToPrev && !tooCloseToNext;
                      
                      return (
                        <div 
                          key={event._id || index} 
                          className="absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2"
                          style={{ left: `${position}%` }}
                        >
                          {/* Status circle with tooltip */}
                          <div className="group relative">
                            <div className={`z-10 w-4 h-4 rounded-full border-2 ${getStatusNodeColor(event.status)}`}></div>
                            
                            {/* Tooltip shown on hover/touch */}
                            <div className="absolute z-20 bottom-full left-1/2 transform -translate-x-1/2 mb-1 bg-white p-1.5 rounded shadow-lg border border-gray-200 text-xs opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 whitespace-nowrap">
                              <div className="font-medium text-gray-700">
                                {event.interviewStage || COLUMN_NAMES[event.status]}
                              </div>
                              <div className="text-gray-500">
                                {formatDate(event.date)}
                              </div>
                              {event.notes && (
                                <div className="mt-1 max-w-[200px] text-gray-600 border-t border-gray-100 pt-1">
                                  {event.notes}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}