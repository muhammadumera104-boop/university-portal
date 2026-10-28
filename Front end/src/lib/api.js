const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
let accessToken = null;
let onSessionExpired = () => {};

export const getAccessToken = () => accessToken;
export function setSessionExpiredHandler(handler) { onSessionExpired = handler; }

async function request(path, options = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers };
  try {
    return await fetch(`${baseUrl}${path}`, { ...options, credentials: 'include', headers });
  } catch {
    throw new Error('The server could not be reached. Check your connection and that the API is running.');
  }
}

export async function login(credentials) {
  const response = await request('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Sign-in could not be completed.');
  accessToken = result.accessToken;
  return { user: result.user, accessToken: result.accessToken };
}

export async function restoreSession() {
  const response = await request('/auth/refresh', { method: 'POST' }).catch(() => null);
  if (!response) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  accessToken = result.accessToken;
  return { user: result.user, accessToken: result.accessToken };
}

export async function signOut() {
  try { await request('/auth/logout', { method: 'POST' }); } finally { accessToken = null; }
}

export async function changePassword(currentPassword, newPassword) {
  return apiRequest('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}

export async function registerAccount(details) {
  return apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(details) });
}

export async function requestPasswordReset(email) {
  return apiRequest('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function resetPassword(accessTokenFromEmail, newPassword) {
  return apiRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify({ accessToken: accessTokenFromEmail, newPassword }) });
}

export async function apiRequest(path, options = {}) {
  let response = await request(path, options);
  if (response.status === 401 && !path.startsWith('/auth/')) {
    const session = await restoreSession();
    if (session) response = await request(path, options);
    else { accessToken = null; onSessionExpired(); }
  }
  if (response.status === 204) return {};
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

// Fetches a short-lived signed URL from the API and opens it, so links never go stale on screen.
export async function openSignedFile(path) {
  const { url } = await apiRequest(path);
  window.open(url, '_blank', 'noopener');
}

export async function downloadGradebook(courseId) {
  const response = await request(`/courses/${courseId}/gradebook.csv`);
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'The gradebook could not be downloaded.'); }
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = 'gradebook.csv'; link.click(); URL.revokeObjectURL(url);
}
