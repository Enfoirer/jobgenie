// app/dashboard/add/page.jsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { APPLICATION_SOURCES, COLUMNS, COLUMN_NAMES } from '@/lib/mockData';

export default function AddJobPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    company: '',
    position: '',
    location: '',
    applicationSource: APPLICATION_SOURCES[0],
    status: COLUMNS.APPLIED,
    dateApplied: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
    notes: ''
  });

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

    try {
      // In a real app, you would make an API call to save the job
      console.log('Submitting job application:', formData);
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Redirect to jobs page
      router.push('/dashboard/jobs');
      
    } catch (error) {
      console.error('Error saving job:', error);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-2xl font-semibold text-gray-800">Add New Job Application</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track a new job you've applied for
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
          {/* Company Name */}
          <div className="sm:col-span-3">
            <label htmlFor="company" className="block text-sm font-medium text-gray-700">
              Company Name
            </label>
            <div className="mt-1">
              <input
                type="text"
                name="company"
                id="company"
                required
                value={formData.company}
                onChange={handleChange}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
              />
            </div>
          </div>

          {/* Position */}
          <div className="sm:col-span-3">
            <label htmlFor="position" className="block text-sm font-medium text-gray-700">
              Position Title
            </label>
            <div className="mt-1">
              <input
                type="text"
                name="position"
                id="position"
                required
                value={formData.position}
                onChange={handleChange}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
              />
            </div>
          </div>

          {/* Location */}
          <div className="sm:col-span-3">
            <label htmlFor="location" className="block text-sm font-medium text-gray-700">
              Location
            </label>
            <div className="mt-1">
              <input
                type="text"
                name="location"
                id="location"
                value={formData.location}
                onChange={handleChange}
                placeholder="City, State or Remote"
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
              />
            </div>
          </div>

          {/* Date Applied */}
          <div className="sm:col-span-3">
            <label htmlFor="dateApplied" className="block text-sm font-medium text-gray-700">
              Date Applied
            </label>
            <div className="mt-1">
              <input
                type="date"
                name="dateApplied"
                id="dateApplied"
                required
                value={formData.dateApplied}
                onChange={handleChange}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
              />
            </div>
          </div>

          {/* Application Source */}
          <div className="sm:col-span-3">
            <label htmlFor="applicationSource" className="block text-sm font-medium text-gray-700">
              Application Source
            </label>
            <div className="mt-1">
              <select
                id="applicationSource"
                name="applicationSource"
                value={formData.applicationSource}
                onChange={handleChange}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
              >
                {APPLICATION_SOURCES.map(source => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Status */}
          <div className="sm:col-span-3">
            <label htmlFor="status" className="block text-sm font-medium text-gray-700">
              Current Status
            </label>
            <div className="mt-1">
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
              >
                {Object.entries(COLUMN_NAMES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="sm:col-span-6">
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              Notes (optional)
            </label>
            <div className="mt-1">
              <textarea
                id="notes"
                name="notes"
                rows={3}
                value={formData.notes}
                onChange={handleChange}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
                placeholder="Include any additional information about this application"
              />
            </div>
          </div>
        </div>

        <div className="pt-5 flex justify-end space-x-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard/jobs')}
            className="bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
              isSubmitting 
                ? 'bg-blue-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}