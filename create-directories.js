// create-directories.js
const fs = require('fs');
const path = require('path');

// Create uploads directory
const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  console.log(`Creating uploads directory: ${uploadsDir}`);
  fs.mkdirSync(uploadsDir, { recursive: true });
} else {
  console.log(`Uploads directory already exists: ${uploadsDir}`);
}

console.log('Directories created successfully!');