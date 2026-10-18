// Shared by the picker and server. The server also verifies file contents.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
export const UPLOAD_TYPES = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
});
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).map((extension) => `.${extension}`).join(',');
export const UPLOAD_HELP = 'PDF, DOCX, PNG, JPG/JPEG · up to 4 MB · one file at a time';
export const uploadError = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateUploadMetadata(file) {
  if (!file || typeof file.name !== 'string' || typeof file.size !== 'number') throw uploadError('Choose a file to upload.');
  const name = file.name.normalize('NFC');
  if (!name || name !== name.trim() || name.length > 180 || new TextEncoder().encode(name).length > 240 ||
      /[\\/:*?"<>|\p{Cc}\p{Cf}]/u.test(name) || name.startsWith('.') || /[. ]$/.test(name)) {
    throw uploadError('Use a filename without paths, control characters or reserved symbols (maximum 240 UTF-8 bytes).');
  }
  const extension = name.split('.').at(-1).toLowerCase();
  if (!Object.hasOwn(UPLOAD_TYPES, extension) || !name.includes('.')) throw uploadError('Only PDF, DOCX, PNG and JPG/JPEG files are supported. Convert DOC files to PDF or DOCX first.', 415);
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw uploadError('Empty files cannot be uploaded.');
  if (file.size > MAX_UPLOAD_BYTES) throw uploadError('File too large (maximum 4 MB).', 413);
  const type = UPLOAD_TYPES[extension];
  const declared = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (declared && declared !== 'application/octet-stream' && declared !== type) throw uploadError('The file type does not match its filename.', 415);
  return { name, type, extension };
}
