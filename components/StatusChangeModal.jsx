// components/StatusChangeModal.jsx
'use client';

import { useState, useEffect } from 'react';
import { COLUMNS, COLUMN_NAMES, INTERVIEW_STAGES } from '@/lib/mockData';

export default function StatusChangeModal({ job, onClose, onStatusChange }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    status: job.status,
    interviewStage: '',
    date: new Date().toISOString().split('T')[0], // Default to today
    notes: ''
  });
  const [previousStages, setPreviousStages] = useState([]);

  useEffect(() => {
    // Fetch previous interview stages if this is an interview status
    const fetchPreviousStages = async () => {
      if (formData.status === COLUMNS.INTERVIEWING) {
        try {
          const response = await fetch(`/api/jobs/${job._id}/status-history`);
          if (response.ok) {
            const data = await response.json();
            // Filter to get only interview stages
            const interviewHistory = data.statusHistory.filter(
              entry => entry.status === COLUMNS.INTERVIEWING && entry.interviewStage
            );
            setPreviousStages(interviewHistory);
          }
        } catch (error) {
          console.error('Error fetching interview history:', error);
        }
      }
    };

    fetchPreviousStages();
  }, [job._id, formData.status]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      console.log('Submitting status change:', formData);
      
      // Prepare the data for submission
      const statusData = {
        status: formData.status,
        date: formData.date,
        notes: formData.notes
      };
      
      // Add interview stage if applicable
      if (formData.status === COLUMNS.INTERVIEWING && formData.interviewStage) {
        statusData.interviewStage = formData.interviewStage;
      }
      
      // Submit to API
      const response = await fetch(`/api/jobs/${job._id}/status-history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(statusData),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update status');
      }
      
      const data = await response.json();
      console.log('Status updated successfully:', data);
      
      // Call the onStatusChange callback
      onStatusChange(formData.status);
      
      // Close the modal
      onClose();
      
    } catch (error) {
      console.error('Error updating status:', error);
      setError(error.message || 'Failed to update status. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
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
                <h3 className="text-lg leading-6 font-medium text-gray-900">
                  Update Status for {job.company} - {job.position}
                </h3>
                
                {error && (
                  <div className="mt-2 rounded-md bg-red-50 p-2">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}
                
                <form onSubmit={handleSubmit} className="mt-4">
                  <div className="space-y-4">
                    {/* Status */}
                    <div>
                      <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                        Status
                      </label>
                      <select
                        id="status"
                        name="status"
                        value={formData.status}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      >
                        {Object.entries(COLUMN_NAMES).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Interview Stage (only shown if status is "Interviewing") */}
                    {formData.status === COLUMNS.INTERVIEWING && (
                      <div>
                        <label htmlFor="interviewStage" className="block text-sm font-medium text-gray-700">
                          Interview Stage
                        </label>
                        <select
                          id="interviewStage"
                          name="interviewStage"
                          value={formData.interviewStage}
                          onChange={handleChange}
                          className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                          <option value="">Select an interview stage</option>
                          {INTERVIEW_STAGES.map(stage => (
                            <option key={stage} value={stage}>{stage}</option>
                          ))}
                        </select>
                        
                        {previousStages.length > 0 && (
                          <div className="mt-2 text-xs text-gray-500">
                            Previous interview stages: 
                            {previousStages.map((stage, index) => (
                              <span key={index} className="ml-1">
                                {stage.interviewStage}
                                {index < previousStages.length - 1 ? ', ' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Date */}
                    <div>
                      <label htmlFor="date" className="block text-sm font-medium text-gray-700">
                        Date
                      </label>
                      <input
                        type="date"
                        id="date"
                        name="date"
                        value={formData.date}
                        onChange={handleChange}
                        required
                        className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    </div>
                    
                    {/* Notes */}
                    <div>
                      <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
                        Notes (optional)
                      </label>
                      <textarea
                        id="notes"
                        name="notes"
                        rows="3"
                        value={formData.notes}
                        onChange={handleChange}
                        className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        placeholder="Add any additional details about this status change"
                      ></textarea>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm ${
                isSubmitting ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? 'Updating...' : 'Update Status'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}