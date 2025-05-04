// app/dashboard/upload/page.jsx
'use client';

import { useState, useRef, useEffect } from 'react';

export default function UploadPage() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    // Fetch files from API
    const fetchFiles = async () => {
      try {
        console.log('Fetching files from API');
        setLoading(true);
        
        const response = await fetch('/api/uploads');
        
        if (!response.ok) {
          throw new Error('Failed to fetch files');
        }
        
        const data = await response.json();
        console.log('Received files:', data);
        setFiles(data.files || []);
      } catch (error) {
        console.error('Error fetching files:', error);
        setError('Failed to load your files. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, []);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = async (uploadedFiles) => {
    setIsUploading(true);
    setError(null);
    
    try {
      console.log(`Uploading ${uploadedFiles.length} files`);
      
      // Create a FormData object for the file upload
      const formData = new FormData();
      
      // Add file to the form data
      formData.append('file', uploadedFiles[0]);
      
      // Upload the file
      const response = await fetch('/api/uploads', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'File upload failed');
      }
      
      const data = await response.json();
      console.log('File uploaded successfully:', data);
      
      // Add new file to the list
      setFiles(prevFiles => [data.file, ...prevFiles]);
      
    } catch (error) {
      console.error('Error uploading files:', error);
      setError('Failed to upload files. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (fileId) => {
    try {
      console.log(`Deleting file ${fileId}`);
      
      // Call API to delete the file
      const response = await fetch(`/api/uploads/${fileId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete file');
      }
      
      console.log('File deleted successfully');
      
      // Remove file from list
      setFiles(files.filter(file => file.id !== fileId));
      
    } catch (error) {
      console.error('Error deleting file:', error);
      setError('Failed to delete file. Please try again.');
    }
  };

  const getFileIcon = (fileType) => {
    if (fileType.includes('pdf')) {
      return (
        <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
        </svg>
      );
    } else if (fileType.includes('word') || fileType.includes('document')) {
      return (
        <svg className="w-8 h-8 text-blue-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
        </svg>
      );
    } else if (fileType.includes('image')) {
      return (
        <svg className="w-8 h-8 text-green-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
        </svg>
      );
    } else {
      return (
        <svg className="w-8 h-8 text-gray-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
        </svg>
      );
    }
  };
  
  const handlePreview = (file) => {
    setPreviewFile(file);
  };
  
  const closePreview = () => {
    setPreviewFile(null);
  };
  
  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-3">
        <h1 className="text-2xl font-semibold text-gray-800">Uploaded Files</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your resumes, cover letters, and other job-related documents
        </p>
      </div>
      
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          </div>
        </div>
      )}
      
      {/* File Upload Area */}
      <div 
        className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center ${
          dragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        
        <div className="mt-2 text-center">
          <p className="text-sm text-gray-600">
            <span className="font-medium text-blue-600 hover:text-blue-500">
              Upload files
            </span>{' '}
            or drag and drop
          </p>
          <p className="mt-1 text-xs text-gray-500">
            PDF, DOC, DOCX, PNG, JPG up to 10MB
          </p>
        </div>
        
        {isUploading && (
          <div className="mt-4">
            <div className="w-full h-1 bg-gray-200 rounded overflow-hidden">
              <div className="h-full bg-blue-500 animate-pulse"></div>
            </div>
            <p className="mt-2 text-sm text-gray-500">Uploading...</p>
          </div>
        )}
      </div>
      
      {/* File List */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="text-center">
            <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="mt-3 text-gray-600">Loading your files...</p>
          </div>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {files.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-gray-500">No files uploaded yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {files.map((file) => (
                <li key={file.id || file._id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center space-x-4">
                    <div className="flex-shrink-0">
                      {getFileIcon(file.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {file.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {file.size} • Uploaded on {new Date(file.uploadDate).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => handlePreview(file)}
                        className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded text-blue-700 bg-blue-100 hover:bg-blue-200"
                      >
                        Preview
                      </button>
                      <button
                        onClick={() => handleDelete(file.id || file._id)}
                        className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded text-red-700 bg-red-100 hover:bg-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      
      {/* File Preview Modal */}
      {previewFile && (
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
                    <h3 className="text-lg leading-6 font-medium text-gray-900">{previewFile.name}</h3>
                    <div className="mt-4 border rounded p-4 bg-gray-50 flex justify-center">
                      {previewFile.type.includes('image') ? (
                        <div className="text-center">
                          <p className="text-sm text-gray-500 mb-2">Image Preview</p>
                          {previewFile.filePath ? (
                            <img 
                              src={previewFile.filePath} 
                              alt={previewFile.name} 
                              className="max-w-full max-h-64 object-contain"
                            />
                          ) : (
                            <div className="bg-gray-200 rounded w-48 h-48 mx-auto flex items-center justify-center">
                              <svg className="w-12 h-12 text-gray-400" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-center">
                          <p className="text-sm text-gray-500 mb-2">Document Preview</p>
                          <div className="bg-gray-200 rounded w-48 h-64 mx-auto flex items-center justify-center">
                            {getFileIcon(previewFile.type)}
                          </div>
                          {previewFile.filePath && (
                            <a 
                              href={previewFile.filePath} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="mt-2 inline-block text-blue-600 hover:underline"
                            >
                              Download
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-4">
                      <p className="text-sm text-gray-500">
                        File Type: {previewFile.type}
                      </p>
                      <p className="text-sm text-gray-500">
                        Size: {previewFile.size}
                      </p>
                      <p className="text-sm text-gray-500">
                        Uploaded: {new Date(previewFile.uploadDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={closePreview}
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