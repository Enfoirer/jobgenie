// components/EditStatusHistoryModal.jsx
'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { COLUMNS, COLUMN_NAMES, INTERVIEW_STAGES } from '@/lib/mockData';

export default function EditStatusHistoryModal({ statusEntry, jobId, onClose, onUpdate }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    status: '',
    interviewStage: '',
    date: '',
    notes: ''
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Lock body scroll when modal is open
    document.body.style.overflow = 'hidden';
    
    return () => {
      setMounted(false);
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (statusEntry) {
      setFormData({
        status: statusEntry.status || COLUMNS.APPLIED,
        interviewStage: statusEntry.interviewStage || '',
        date: statusEntry.date ? new Date(statusEntry.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        notes: statusEntry.notes || ''
      });
    }
  }, [statusEntry]);

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
      const response = await fetch(`/api/jobs/${jobId}/status-history/${statusEntry._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update status history');
      }
      
      const result = await response.json();
      
      if (onUpdate) {
        onUpdate(result.statusHistory);
      }
      
      onClose();
      
    } catch (error) {
      console.error('Error updating status history:', error);
      setError(error.message || 'Failed to update status. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this status history entry? This cannot be undone.')) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch(`/api/jobs/${jobId}/status-history/${statusId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete status history');
      }
      
      if (onUpdate) {
        onUpdate(null, true);
      }
      
      onClose();
      
    } catch (error) {
      console.error('Error deleting status history:', error);
      setError(error.message || 'Failed to delete status. Please try again.');
      setIsSubmitting(false);
    }
  };

  // The modal content
  const modalContent = (
    <div id="status-history-modal-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100vw',  // Force full viewport width
      height: '100vh', // Force full viewport height
      margin: 0,       // Remove any margins
      padding: 0,      // Remove any padding
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,   // Extremely high z-index
      boxSizing: 'border-box', // Ensure padding doesn't add to dimensions
    }}>
      <div id="status-history-modal-content" style={{
        backgroundColor: 'white',
        borderRadius: '6px',
        width: '92%',
        maxWidth: '550px',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
        margin: '0 auto', // Center horizontally
        position: 'relative', // Ensure it's positioned correctly
        animation: 'fadeIn 0.2s ease-out',
      }} onClick={e => e.stopPropagation()}>
        <style>
          {`
            @keyframes fadeIn {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}
        </style>
        
        <div style={{ 
          padding: '16px 20px', 
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb'
        }}>
          <h2 style={{ 
            fontSize: '20px', 
            fontWeight: '600', 
            color: '#111827',
            margin: 0
          }}>
            Edit Status History
          </h2>
        </div>
        
        <div style={{ padding: '20px' }}>
          {error && (
            <div style={{ 
              marginBottom: '20px', 
              backgroundColor: '#fee2e2', 
              padding: '10px 12px', 
              borderRadius: '4px', 
              color: '#b91c1c',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '6px', 
              fontWeight: '500',
              color: '#374151',
              fontSize: '16px'
            }}>
              Status
            </label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '16px',
                backgroundColor: 'white',
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 10px center',
                backgroundSize: '16px',
                paddingRight: '35px'
              }}
            >
              {Object.entries(COLUMN_NAMES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          
          {formData.status === COLUMNS.INTERVIEWING && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ 
                display: 'block', 
                marginBottom: '6px', 
                fontWeight: '500',
                color: '#374151',
                fontSize: '16px'
              }}>
                Interview Stage
              </label>
              <select
                name="interviewStage"
                value={formData.interviewStage}
                onChange={handleChange}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '16px',
                  backgroundColor: 'white',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  backgroundSize: '16px',
                  paddingRight: '35px'
                }}
              >
                <option value="">Select an interview stage</option>
                {INTERVIEW_STAGES.map(stage => (
                  <option key={stage} value={stage}>{stage}</option>
                ))}
              </select>
            </div>
          )}
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '6px', 
              fontWeight: '500',
              color: '#374151',
              fontSize: '16px'
            }}>
              Date
            </label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '16px',
                backgroundColor: 'white'
              }}
            />
          </div>
          
          <div style={{ marginBottom: '10px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '6px', 
              fontWeight: '500',
              color: '#374151',
              fontSize: '16px'
            }}>
              Notes
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="4"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '16px',
                minHeight: '100px',
                resize: 'vertical',
                fontFamily: 'inherit'
              }}
              placeholder="Add any notes about this status change"
            ></textarea>
          </div>
        </div>
        
        <div style={{ 
          padding: '16px 20px', 
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          backgroundColor: '#f9fafb'
        }}>
          <button
            type="button"
            onClick={handleDelete}
            style={{
              backgroundColor: '#ef4444',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: '500',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Delete
          </button>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: 'white',
                color: '#374151',
                padding: '8px 16px',
                borderRadius: '6px',
                fontWeight: '500',
                border: '1px solid #d1d5db',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Cancel
            </button>
            
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              style={{
                backgroundColor: isSubmitting ? '#60a5fa' : '#2563eb',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                fontWeight: '500',
                border: 'none',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: '14px'
              }}
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Use createPortal to render the modal directly in the document body
  return mounted ? createPortal(modalContent, document.body) : null;
}