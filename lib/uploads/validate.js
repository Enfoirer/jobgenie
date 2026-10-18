import yauzl from 'yauzl';
import { MAX_UPLOAD_BYTES, uploadError, validateUploadMetadata } from './policy.js';

const invalidContent = () => uploadError('The file contents do not match a supported document or image. Export the file again and retry.', 415);

async function validateDocx(data) {
  let zip;
  try {
    zip = await yauzl.fromBufferPromise(data, { strictFileNames: true, validateEntrySizes: true });
    if (zip.entryCount > 512) throw invalidContent();
    const names = new Set();
    const required = new Map([['[Content_Types].xml', null], ['_rels/.rels', null], ['word/document.xml', null]]);
    let total = 0;
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      // No extraction to disk; also reject ambiguous, encrypted or macro packages.
      if (names.has(name.toLowerCase()) || /[\p{Cc}\p{Cf}]/u.test(name) ||
          entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod) ||
          /(?:vbaProject|vbaData|activeX|embeddings)(?:[./]|$)/i.test(name) ||
          ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw invalidContent();
      names.add(name.toLowerCase());
      total += entry.uncompressedSize;
      if (total > 32 * 1024 * 1024 || entry.uncompressedSize > 16 * 1024 * 1024) throw invalidContent();
      if (name.endsWith('/')) continue;
      const capture = required.has(name);
      if (capture && entry.uncompressedSize > 8 * 1024 * 1024) throw invalidContent();
      const stream = await zip.openReadStreamPromise(entry);
      let actual = 0;
      const chunks = [];
      for await (const chunk of stream) {
        actual += chunk.length;
        if (actual > entry.uncompressedSize || actual > 16 * 1024 * 1024) { stream.destroy(); throw invalidContent(); }
        if (capture) chunks.push(chunk);
      }
      if (actual !== entry.uncompressedSize) throw invalidContent();
      if (capture) required.set(name, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    }
    const types = required.get('[Content_Types].xml');
    const relationships = required.get('_rels/.rels');
    const document = required.get('word/document.xml');
    if (!types || !relationships || !document ||
        !types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') ||
        /macroEnabled|vbaProject/i.test(types) ||
        !relationships.includes('/officeDocument') || !relationships.includes('word/document.xml') ||
        !/<(?:[\w.-]+:)?document[\s>]/.test(document) ||
        !/http:\/\/(?:schemas.openxmlformats.org\/wordprocessingml\/2006\/main|purl.oclc.org\/ooxml\/wordprocessingml\/main)/.test(document) ||
        [...required.values()].some((xml) => /<!DOCTYPE|<!ENTITY/i.test(xml))) throw invalidContent();
  } catch { throw invalidContent(); }
  finally { zip?.close(); }
}

// Format identity checks are not antivirus scanning or document sanitization.
// Every accepted file is still delivered as an attachment with an inert MIME type.
export async function validateUpload(file) {
  const metadata = validateUploadMetadata(file);
  if (typeof file.arrayBuffer !== 'function') throw uploadError('Choose a file to upload.');
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length !== file.size || data.length > MAX_UPLOAD_BYTES) throw uploadError('Invalid file size.', 413);
  const { extension } = metadata;
  if (extension === 'pdf') {
    if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(data.subarray(0, 16).toString('latin1')) ||
        !/%%EOF\s*$/.test(data.subarray(-1024).toString('latin1'))) throw invalidContent();
  } else if (extension === 'png') {
    if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        data.readUInt32BE(8) !== 13 || data.subarray(12, 16).toString() !== 'IHDR' ||
        !data.readUInt32BE(16) || !data.readUInt32BE(20) ||
        !data.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) throw invalidContent();
  } else if (extension === 'jpg' || extension === 'jpeg') {
    if (data.length < 12 || !data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
        !data.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) throw invalidContent();
  } else {
    if (!data.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) throw invalidContent();
    await validateDocx(data);
  }
  return { ...metadata, data };
}
