import { useState } from 'react';
import { Paperclip, Send } from 'lucide-react';
import { apiRequest, openSignedFile } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { ErrorNotice, Modal } from '../components/ui.jsx';

export default function SubmissionDialog({ assignment, onClose, onSubmitted }) {
  const previous = assignment.my_submission;
  const [error, setError] = useState(''); const [sending, setSending] = useState(false);
  const late = new Date(assignment.due_at) < new Date();
  async function submit(event) {
    event.preventDefault(); setError('');
    const body = new FormData(event.currentTarget);
    if (!String(body.get('text_answer')).trim() && !body.get('file')?.size && !previous?.file_path) { setError('Add a written answer or attach a file.'); return; }
    if (!body.get('file')?.size) body.delete('file');
    setSending(true);
    try { await apiRequest(`/assignments/${assignment.id}/submission`, { method: 'PUT', body }); await onSubmitted(); }
    catch (reason) { setError(reason.message); }
    finally { setSending(false); }
  }
  return <Modal title={assignment.title} kicker={previous ? 'RESUBMIT YOUR WORK' : 'SUBMIT YOUR WORK'} onClose={onClose} wide>
    <form className="modal-form" onSubmit={submit}>
      <p className="modal-intro">Due {formatDateTime(assignment.due_at)} · {assignment.max_marks} marks{late ? (assignment.allow_late ? ' · This will be marked late.' : '') : ''}</p>
      {assignment.instructions && <div className="assignment-instructions">{assignment.instructions}</div>}
      {previous && <p className="modal-intro">Resubmitting replaces your previous submission{previous.status === 'graded' ? ' and clears its grade' : ''}.</p>}
      <label>Your answer<textarea name="text_answer" rows="7" maxLength="20000" defaultValue={previous?.text_answer || ''} placeholder="Write your response here…" /></label>
      <label className="file-picker"><Paperclip size={14}/> {previous?.file_path ? 'Replace attached file (optional)' : 'Attach a file (optional)'}<input name="file" type="file" accept=".pdf,.docx,.pptx,.zip,.png,.jpg,.jpeg,.txt"/><small>PDF, DOCX, PPTX, ZIP, PNG, JPG or TXT · 25 MB max</small></label>
      {previous?.file_path && <div className="submission-file-row"><button type="button" className="text-link" onClick={() => openSignedFile(`/submissions/${previous.id}/file`).catch((reason) => setError(reason.message))}>Open current file</button><label className="checkbox-label"><input type="checkbox" name="remove_file" value="true"/> Remove it</label></div>}
      <ErrorNotice error={error}/>
      <div className="modal-actions"><button type="button" className="button-quiet" onClick={onClose}>Cancel</button><button className="button-primary" disabled={sending}><Send size={14}/>{sending ? 'Submitting…' : previous ? 'Resubmit' : 'Submit'}</button></div>
    </form>
  </Modal>;
}
