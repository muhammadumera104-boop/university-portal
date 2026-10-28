import { useState } from 'react';
import { Download, Users } from 'lucide-react';
import { apiRequest } from '../lib/api.js';
import { ErrorNotice, Modal } from '../components/ui.jsx';

function parseAccountsCsv(text) {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')));
  if (rows.length && /email/i.test(rows[0].join(','))) rows.shift();
  return rows.map(([fullName, email, role, rollNo]) => ({ fullName, email, role: (role || 'student').toLowerCase(), rollNo: rollNo || undefined }));
}

const quote = (cell) => `"${String(cell).replaceAll('"', '""')}"`;

export default function BulkImport({ onClose, onDone }) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [working, setWorking] = useState(false); const [outcome, setOutcome] = useState(null);
  const parsed = parseAccountsCsv(text);

  async function run() {
    setError('');
    if (!parsed.length) { setError('Paste at least one row, or choose a CSV file.'); return; }
    setWorking(true);
    try {
      const result = await apiRequest('/admin/users/bulk', { method: 'POST', body: JSON.stringify({ users: parsed.slice(0, 100) }) });
      setOutcome(result); onDone();
    } catch (reason) { setError(reason.message); } finally { setWorking(false); }
  }

  function download() {
    const lines = ['Email,Name,Role,One-time password', ...outcome.results.filter((row) => row.ok).map((row) => [row.email, row.fullName, row.role, row.temporaryPassword].map(quote).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    const link = document.createElement('a'); link.href = url; link.download = 'new-accounts.csv'; link.click(); URL.revokeObjectURL(url);
  }

  return <Modal title="Import accounts from CSV" kicker="BULK CREATE" onClose={onClose} wide>
    {outcome ? <>
      <p className="modal-intro">{outcome.created} created, {outcome.failed} failed. The one-time passwords are shown only now, so download them before closing.</p>
      <div className="results-table">{outcome.results.map((row, index) => <div className="results-row" key={index}><b>{row.email || '(blank)'}</b><span>{row.ok ? row.role : 'Not created'}</span><span>{row.ok ? row.temporaryPassword : row.error}</span><small>{row.ok ? 'Created' : 'Failed'}</small></div>)}</div>
      <div className="modal-actions"><button className="button-quiet" onClick={download} disabled={!outcome.created}><Download size={14} /> Download passwords</button><button className="button-primary" onClick={onClose}>Done</button></div>
    </> : <>
      <p className="modal-intro">One person per line: <code>Full name, email, role, roll number</code>. Role is <code>teacher</code> or <code>student</code> (default student). Up to 100 rows. Each person must change their one-time password at first sign-in.</p>
      <label className="file-picker">Choose a CSV file<input type="file" accept=".csv,text/csv,text/plain" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setText(await file.text()); }} /></label>
      <label>Or paste rows<textarea value={text} onChange={(event) => setText(event.target.value)} rows="8" placeholder={'Sara Khan, sara@school.edu, student, 2024-001\nAli Raza, ali@school.edu, teacher'} /></label>
      <p className="field-note">{parsed.length} row{parsed.length === 1 ? '' : 's'} ready{parsed.length > 100 ? ' (only the first 100 will be imported)' : ''}.</p>
      <ErrorNotice error={error} />
      <div className="modal-actions"><button className="button-quiet" onClick={onClose}>Cancel</button><button className="button-primary" onClick={run} disabled={working || !parsed.length}><Users size={14} /> {working ? 'Creating…' : `Create ${Math.min(parsed.length, 100)} accounts`}</button></div>
    </>}
  </Modal>;
}
