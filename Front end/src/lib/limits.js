// Mirrors MAX_UPLOAD_MB on the API. Set VITE_MAX_UPLOAD_MB to the same value (4 on Vercel) so people see the real limit before uploading.
const configured = Number(import.meta.env.VITE_MAX_UPLOAD_MB);
export const maxUploadMb = Math.min(Math.max(configured || 25, 1), 25);
export const complaintUploadMb = Math.min(10, maxUploadMb);
export const maxUploadBytes = maxUploadMb * 1024 * 1024;
