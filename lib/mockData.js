// lib/mockData.js

export const COLUMNS = {
    APPLIED: 'applied',
    INTERVIEWING: 'interviewing',
    COMPLETED: 'completed'
  };
  
  export const COLUMN_NAMES = {
    [COLUMNS.APPLIED]: 'Applied',
    [COLUMNS.INTERVIEWING]: 'Interviewing',
    [COLUMNS.COMPLETED]: 'Completed'
  };
  
  export const APPLICATION_SOURCES = [
    'LinkedIn',
    'Indeed',
    'Company Website',
    'Referral',
    'Job Fair',
    'Other'
  ];
  
  export const mockJobs = {
    jobs: [
      {
        id: '1',
        company: 'TechCorp',
        position: 'Frontend Developer',
        location: 'New York, NY',
        applicationSource: 'LinkedIn',
        status: COLUMNS.APPLIED,
        dateApplied: '2025-04-15',
        notes: 'Applied through LinkedIn Easy Apply'
      },
      {
        id: '2',
        company: 'StartupX',
        position: 'Full Stack Engineer',
        location: 'Remote',
        applicationSource: 'Referral',
        status: COLUMNS.APPLIED,
        dateApplied: '2025-04-10',
        notes: 'Referred by John from CS 5356'
      },
      {
        id: '3',
        company: 'BigTech Inc',
        position: 'Software Engineer Intern',
        location: 'San Francisco, CA',
        applicationSource: 'Company Website',
        status: COLUMNS.INTERVIEWING,
        dateApplied: '2025-04-05',
        notes: 'First round interview scheduled for May 10'
      },
      {
        id: '4',
        company: 'FinTech Solutions',
        position: 'Backend Developer',
        location: 'Chicago, IL',
        applicationSource: 'Indeed',
        status: COLUMNS.INTERVIEWING,
        dateApplied: '2025-04-02',
        notes: 'Second round interview completed, waiting for feedback'
      },
      {
        id: '5',
        company: 'AI Innovations',
        position: 'ML Engineer',
        location: 'Seattle, WA',
        applicationSource: 'Job Fair',
        status: COLUMNS.COMPLETED,
        dateApplied: '2025-03-25',
        notes: 'Rejected after final round'
      },
      {
        id: '6',
        company: 'Cornell Tech',
        position: 'Research Assistant',
        location: 'New York, NY',
        applicationSource: 'Referral',
        status: COLUMNS.COMPLETED,
        dateApplied: '2025-03-20',
        notes: 'Offer received! Starting June 1'
      }
    ]
  };
  
  export const mockFiles = [
    {
      id: '1',
      name: 'Resume_2025.pdf',
      type: 'application/pdf',
      size: '456 KB',
      uploadDate: '2025-04-01'
    },
    {
      id: '2',
      name: 'CoverLetter_TechCorp.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: '324 KB',
      uploadDate: '2025-04-15'
    },
    {
      id: '3',
      name: 'Portfolio_Screenshot.png',
      type: 'image/png',
      size: '1.2 MB',
      uploadDate: '2025-03-25'
    }
  ];