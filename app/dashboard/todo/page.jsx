// app/dashboard/todo/page.jsx
'use client';

import { useState, useEffect } from 'react';
import { COLUMNS } from '@/lib/mockData';

// Day names for the calendar header
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function TodoPage() {
  const [jobsData, setJobsData] = useState([]);
  const [interviewEvents, setInterviewEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [view, setView] = useState('month'); // 'month', 'week', or 'day'
  const [filterType, setFilterType] = useState('all'); // 'all', 'upcoming', 'past', 'today'
  const [copiedNote, setCopiedNote] = useState(false);

  // Calculate the current month's days
  const [calendarDays, setCalendarDays] = useState([]);

  useEffect(() => {
    // Fetch jobs from API
    const fetchJobs = async () => {
      try {
        console.log('Fetching jobs for Todo calendar');
        setLoading(true);
        
        const response = await fetch('/api/jobs');
        
        if (!response.ok) {
          throw new Error('Failed to fetch jobs');
        }
        
        const data = await response.json();
        console.log('Received jobs for Todo calendar:', data);
        setJobsData(data.jobs || []);
      } catch (error) {
        console.error('Error fetching jobs:', error);
        setError('Failed to load job data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchJobs();
  }, []);

  useEffect(() => {
    // Extract interview events from job data
    const extractInterviewEvents = async () => {
      try {
        const events = [];
        const interviewingJobs = jobsData.filter(job => 
          job.status === COLUMNS.INTERVIEWING
        );

        // For each interviewing job, fetch its status history
        for (const job of interviewingJobs) {
          try {
            const historyResponse = await fetch(`/api/jobs/${job._id}/status-history`);
            if (!historyResponse.ok) {
              continue;
            }
            
            const historyData = await historyResponse.json();
            const statusHistory = historyData.statusHistory || [];
            
            // Filter for interviewing status entries with a date
            const interviewStatuses = statusHistory.filter(entry => 
              entry.status === COLUMNS.INTERVIEWING && entry.date
            );

            // Create event objects for each interview status
            interviewStatuses.forEach(entry => {
              events.push({
                id: entry._id,
                jobId: job._id,
                company: job.company,
                position: job.position,
                date: new Date(entry.date),
                notes: entry.notes || '',
                interviewStage: entry.interviewStage || 'Interview',
                past: new Date(entry.date) < new Date(new Date().setHours(0, 0, 0, 0)),
                isToday: isSameDay(new Date(entry.date), new Date())
              });
            });
          } catch (error) {
            console.error(`Error fetching history for job ${job._id}:`, error);
          }
        }

        setInterviewEvents(events);
      } catch (error) {
        console.error('Error processing interview events:', error);
      }
    };

    if (jobsData.length > 0) {
      extractInterviewEvents();
    }
  }, [jobsData]);

  useEffect(() => {
    // Generate the calendar days for the current month view
    const generateCalendarDays = () => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      
      // First day of the month
      const firstDay = new Date(year, month, 1);
      // Last day of the month
      const lastDay = new Date(year, month + 1, 0);
      
      // Start from the first day of the week that contains the first day of the month
      const start = new Date(firstDay);
      start.setDate(start.getDate() - start.getDay());
      
      // End on the last day of the week that contains the last day of the month
      const end = new Date(lastDay);
      const daysToAdd = 6 - end.getDay();
      end.setDate(end.getDate() + daysToAdd);
      
      const days = [];
      let day = new Date(start);
      
      // Generate all days from start to end
      while (day <= end) {
        days.push(new Date(day));
        day.setDate(day.getDate() + 1);
      }
      
      setCalendarDays(days);
    };
    
    generateCalendarDays();
  }, [currentDate]);

  // Helper to check if two dates are the same day
  const isSameDay = (date1, date2) => {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  };

  // Helper to get events for a specific day
  const getEventsForDay = (day) => {
    // Filter events based on the current filter type
    let filteredEvents = interviewEvents;
    
    if (filterType === 'upcoming') {
      filteredEvents = interviewEvents.filter(event => !event.past);
    } else if (filterType === 'past') {
      filteredEvents = interviewEvents.filter(event => event.past);
    } else if (filterType === 'today') {
      filteredEvents = interviewEvents.filter(event => event.isToday);
    }
    
    return filteredEvents.filter(event => isSameDay(event.date, day));
  };

  // Handle month navigation
  const handlePrevMonth = () => {
    setCurrentDate(prevDate => {
      const newDate = new Date(prevDate);
      newDate.setMonth(newDate.getMonth() - 1);
      return newDate;
    });
  };

  const handleNextMonth = () => {
    setCurrentDate(prevDate => {
      const newDate = new Date(prevDate);
      newDate.setMonth(newDate.getMonth() + 1);
      return newDate;
    });
  };

  // Handle event click
  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setCopiedNote(false);
  };

  // Handle close modal
  const handleCloseModal = () => {
    setSelectedEvent(null);
    setCopiedNote(false);
  };

  // Copy note to clipboard
  const copyNoteToClipboard = () => {
    if (selectedEvent && selectedEvent.notes) {
      navigator.clipboard.writeText(selectedEvent.notes)
        .then(() => {
          setCopiedNote(true);
          setTimeout(() => setCopiedNote(false), 2000);
        })
        .catch(err => {
          console.error('Failed to copy text: ', err);
        });
    }
  };

  // Format date to display
  const formatDate = (date) => {
    return new Intl.DateTimeFormat('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric'
    }).format(date);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your interview schedule...</p>
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

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-3">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800">Interview To-Do</h1>
            <p className="mt-1 text-sm text-gray-500">
              Track your upcoming and past interviews
            </p>
          </div>
          
          {/* Filter controls */}
          <div className="flex space-x-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
            >
              <option value="all">All Interviews</option>
              <option value="upcoming">Upcoming</option>
              <option value="today">Today</option>
              <option value="past">Past</option>
            </select>
          </div>
        </div>
      </div>

      {/* Calendar header */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="flex justify-between items-center bg-gray-50 px-4 py-2">
          <button
            onClick={handlePrevMonth}
            className="p-1 rounded-full hover:bg-gray-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </button>
          
          <h2 className="text-lg font-medium text-gray-900">
            {new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentDate)}
          </h2>
          
          <button
            onClick={handleNextMonth}
            className="p-1 rounded-full hover:bg-gray-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Calendar day headers */}
        <div className="grid grid-cols-7 border-b">
          {DAYS.map(day => (
            <div key={day} className="py-2 text-center text-sm font-medium text-gray-500">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 h-[500px]">
          {calendarDays.map((day, index) => {
            const isCurrentMonth = day.getMonth() === currentDate.getMonth();
            const isToday = isSameDay(day, new Date());
            const dayEvents = getEventsForDay(day);
            
            return (
              <div 
                key={index} 
                className={`border-b border-r p-1 overflow-hidden ${
                  !isCurrentMonth ? 'bg-gray-50 text-gray-400' : ''
                } ${isToday ? 'bg-blue-50' : ''}`}
              >
                <div className="text-right">
                  <span className={`text-sm ${
                    isToday ? 'bg-blue-500 text-white rounded-full h-6 w-6 flex items-center justify-center ml-auto' : ''
                  }`}>
                    {day.getDate()}
                  </span>
                </div>
                
                {/* Events for this day */}
                <div className="mt-1 space-y-1 max-h-[80px] overflow-y-auto">
                  {dayEvents.map(event => (
                    <div
                      key={event.id}
                      onClick={() => handleEventClick(event)}
                      className={`px-2 py-1 text-xs rounded-sm cursor-pointer truncate ${
                        event.past ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      <div className="font-medium truncate">{event.company}</div>
                      <div className="truncate">{event.interviewStage}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming interviews list view */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-800">
            {filterType === 'all' ? 'All Interviews' : 
             filterType === 'upcoming' ? 'Upcoming Interviews' :
             filterType === 'today' ? 'Today\'s Interviews' : 'Past Interviews'}
          </h2>
        </div>
        
        <div className="divide-y divide-gray-200">
          {interviewEvents.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              No interviews found
            </div>
          ) : (
            <>
              {interviewEvents
                .filter(event => {
                  if (filterType === 'upcoming') return !event.past;
                  if (filterType === 'past') return event.past;
                  if (filterType === 'today') return event.isToday;
                  return true;
                })
                .sort((a, b) => a.date - b.date)
                .map(event => (
                  <div 
                    key={event.id} 
                    className={`p-4 hover:bg-gray-50 cursor-pointer ${
                      event.isToday ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => handleEventClick(event)}
                  >
                    <div className="flex justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900">{event.company}</h3>
                        <p className="text-sm text-gray-500">{event.position}</p>
                      </div>
                      <div className="text-right">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          event.past ? 'bg-gray-100 text-gray-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {event.interviewStage}
                        </span>
                        <p className="text-sm text-gray-500 mt-1">{formatDate(event.date)}</p>
                      </div>
                    </div>
                  </div>
                ))
              }
            </>
          )}
        </div>
      </div>

      {/* Event details modal */}
      {selectedEvent && (
        <div className="fixed inset-0 overflow-y-auto z-50">
          <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>
            
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen"></span>&#8203;
            
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                    <h3 className="text-lg leading-6 font-medium text-gray-900 flex justify-between">
                      <span>Interview Details</span>
                      <button 
                        onClick={handleCloseModal}
                        className="text-gray-400 hover:text-gray-500"
                      >
                        <span className="sr-only">Close</span>
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </h3>
                    
                    <div className="mt-4">
                      <div className="mb-4">
                        <h4 className="text-base font-bold text-gray-800">{selectedEvent.company}</h4>
                        <p className="text-sm text-gray-600">{selectedEvent.position}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <p className="text-sm text-gray-500">Interview Type</p>
                          <p className="text-sm font-medium">{selectedEvent.interviewStage}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500">Date</p>
                          <p className="text-sm font-medium">{formatDate(selectedEvent.date)}</p>
                        </div>
                      </div>
                      
                      {selectedEvent.notes && (
                        <div className="mt-4">
                          <div className="flex justify-between items-center">
                            <h4 className="text-sm font-medium text-gray-700">Notes</h4>
                            <button
                              onClick={copyNoteToClipboard}
                              className="text-xs text-blue-600 hover:text-blue-800"
                            >
                              {copiedNote ? 'Copied!' : 'Copy to clipboard'}
                            </button>
                          </div>
                          <div className="mt-1 p-2 bg-gray-50 rounded text-sm text-gray-800">
                            {selectedEvent.notes}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}