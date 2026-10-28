import path from 'node:path';
import { randomUUID } from 'node:crypto';

const mimeByExtension = new Map([
  ['.pdf', 'application/pdf'], ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'], ['.zip', 'application/zip'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'], ['.webp', 'image/webp'],
  ['.txt', 'text/plain'],
]);
const zipMimes = new Set(['application/zip', 'application/x-zip-compressed']);

// Returns the canonical MIME type when the extension is allowed and the file's leading bytes match it; otherwise null.
export function detectAllowedMime(file, allowedExtensions) {
  const extension = path.extname(file.originalname).toLowerCase();
  const expected = mimeByExtension.get(extension);
  if (!expected || !allowedExtensions.includes(extension)) return null;
  // Browsers on Windows commonly report ZIP files as application/x-zip-compressed.
  if (file.mimetype !== expected && !(extension === '.zip' && zipMimes.has(file.mimetype))) return null;
  const bytes = file.buffer;
  const signature = bytes.subarray(0, 8).toString('hex');
  const officeZip = bytes.subarray(0, 4).toString('hex') === '504b0304';
  const content = officeZip ? bytes.toString('latin1') : '';
  const valid = extension === '.pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : extension === '.png' ? signature.startsWith('89504e470d0a1a0a')
      : extension === '.jpg' || extension === '.jpeg' ? signature.startsWith('ffd8ff')
        : extension === '.gif' ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())
          : extension === '.webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
            : extension === '.docx' ? officeZip && content.includes('word/document.xml')
              : extension === '.pptx' ? officeZip && content.includes('ppt/presentation.xml')
                : extension === '.zip' ? officeZip
                  : extension === '.txt' ? !bytes.includes(0) : false;
  return valid ? expected : null;
}

export function safeFileName(originalName, maxLength = 150) {
  return path.basename(originalName).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, maxLength);
}

export function storagePath(prefix, originalName) {
  return `${prefix}/${randomUUID()}-${safeFileName(originalName)}`;
}
