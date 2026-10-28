export const initials = (name = '') => name.trim().split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

export const formatDateTime = (value) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const formatDate = (value) => value ? new Date(value).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export function relativeTime(value) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const formatter = new Intl.RelativeTimeFormat([], { numeric: 'auto' });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  return 'just now';
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const roleLabels = { admin: 'Administrator', teacher: 'Teacher', student: 'Student' };
export const roleLabel = (role) => roleLabels[role] || 'Member';

// Student-facing status for an assignment, decided from the server's submission record and due date.
export function assignmentStatus(assignment) {
  const submission = assignment.my_submission;
  if (submission?.status === 'graded') return 'Graded';
  if (submission) return submission.is_late ? 'Submitted late' : 'Submitted';
  const due = new Date(assignment.due_at).getTime();
  if (due < Date.now()) return assignment.allow_late ? 'Overdue' : 'Missed';
  if (due - Date.now() < 48 * 3600 * 1000) return 'Due soon';
  return 'Not started';
}

