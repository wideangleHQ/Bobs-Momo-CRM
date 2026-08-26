'use client';

import { apiPost } from '@/lib/api';

/**
 * A 4 MB phone photo becomes about 300 KB. Thirty seconds of upload on outlet
 * wifi is long enough for somebody to lock their phone and lose the form.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.7;

async function compress(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  return blob ?? file;
}

interface AttachmentResponse {
  attachmentId?: string;
  id?: string;
  uploadUrl?: string;
}

/** Returns the attachment id a checklist result points at. */
export async function uploadTaskPhoto(taskId: string, file: File): Promise<string> {
  const blob = await compress(file);
  const created = await apiPost<AttachmentResponse>(`/tasks/${taskId}/attachments`, {
    mimeType: 'image/jpeg',
    sizeBytes: blob.size,
  });
  if (created.uploadUrl) {
    const res = await fetch(created.uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    if (!res.ok) throw new Error('The photo did not upload. Tap the camera again.');
  }
  const id = created.attachmentId ?? created.id;
  if (!id) throw new Error('The photo did not upload. Tap the camera again.');
  return id;
}
