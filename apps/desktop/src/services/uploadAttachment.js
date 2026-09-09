export const PDF_MIME = 'application/pdf';

export function isPdfAttachment(file) {
  const type = String(file?.type || '').trim().toLowerCase();
  return type === PDF_MIME ||
    ((!type || type === 'application/octet-stream') && /\.pdf$/i.test(String(file?.name || '')));
}

export function isAcceptedUploadAttachment(file, allowPdf = false) {
  return Boolean(file && (String(file.type || '').startsWith('image/') ||
    (allowPdf && isPdfAttachment(file))));
}

export function isPdfAttachmentUrl(url) {
  try {
    return new URL(String(url)).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return String(url || '').split(/[?#]/, 1)[0].toLowerCase().endsWith('.pdf');
  }
}

export async function prepareUploadAttachment(file, { allowPdf = false, prepareImage }) {
  if (allowPdf && isPdfAttachment(file)) {
    const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (header.length !== 5 || ![37, 80, 68, 70, 45].every((byte, index) => header[index] === byte)) {
      throw new Error('This file is not a valid PDF attachment');
    }
    // Windows may omit the MIME type. Sign and upload the validated bytes as PDF.
    return file.type === PDF_MIME ? file : new File([file], file.name || 'attachment.pdf', {
      type: PDF_MIME,
      lastModified: file.lastModified,
    });
  }
  if (!String(file?.type || '').startsWith('image/')) {
    throw new Error(allowPdf ? 'Choose an image or PDF attachment' : 'Choose an image');
  }
  return prepareImage(file);
}
