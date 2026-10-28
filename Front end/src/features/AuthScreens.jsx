import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Compass, Eye, EyeOff } from 'lucide-react';
import { changePassword, login, registerAccount, requestPasswordReset, resetPassword } from '../lib/api.js';
import { brand } from '../brand.js';

const passwordRule = 'Use at least 10 characters, including one letter and one number.';
const meetsPolicy = (value) => value.length >= 10 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);

export function AuthScreen({ onAuthenticated }) {
  const location = useLocation();
  if (location.pathname === '/forgot-password') return <ForgotPasswordScreen />;
  if (location.pathname === '/reset-password') return <ResetPasswordScreen />;
  if (location.pathname === '/register') return <RegisterScreen />;
  return <LoginScreen onAuthenticated={onAuthenticated} />;
}

function AuthFrame({ kicker, title, description, children }) {
  return <main className="auth-screen"><div className="auth-art"><div className="auth-brand"><span className="brand-mark"><Compass size={22} /></span><span>{brand.wordmark}<span className="brand-period">.</span></span></div><div className="auth-orbit orbit-one"/><div className="auth-orbit orbit-two"/><div className="auth-orbit orbit-three"/><div className="auth-core"><Compass size={39}/></div><div className="auth-art-copy"><span>{brand.tagline.toUpperCase()}</span><h1>{brand.authHeadline[0]}<br/>{brand.authHeadline[1]}</h1><p>A little curiosity can change everything.</p></div></div><div className="auth-form-wrap"><section className="auth-form"><span className="eyebrow"><span className="eyebrow-line"/> {kicker}</span><h2>{title}</h2><p>{description}</p>{children}</section></div></main>;
}

function PasswordField({ label, value, onChange, autoComplete, minLength }) {
  const [visible, setVisible] = useState(false);
  return <label>{label}<span className="password-field"><input type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} required minLength={minLength} autoComplete={autoComplete} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>;
}

function PasswordStrength({ value }) {
  if (!value) return null;
  const checks = [value.length >= 10, /[A-Za-z]/.test(value), /[0-9]/.test(value), value.length >= 14 || /[^A-Za-z0-9]/.test(value)];
  const score = checks.filter(Boolean).length;
  const label = !meetsPolicy(value) ? 'Too weak' : score === 4 ? 'Strong' : 'Good';
  return <div className={`password-strength strength-${score}`} aria-live="polite"><span><i/><i/><i/><i/></span><small>{label}</small></div>;
}

function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault(); setLoading(true); setError('');
    try { onAuthenticated(await login({ email, password })); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }
  return <AuthFrame kicker="WELCOME BACK" title={<>Sign in to<br/>{brand.name}.</>} description="Sign in with your email and password."><form className="auth-fields" onSubmit={submit}><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" placeholder="you@school.edu"/></label><PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password"/><button type="button" className="forgot-link" onClick={() => navigate('/forgot-password')}>Forgot password?</button>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}<ArrowRight size={15}/></button><button type="button" className="button-quiet" onClick={() => navigate('/register')}>New student? Create an account</button><small>Registrations are reviewed by an administrator before you can sign in. Teachers receive their accounts from an administrator.</small></form></AuthFrame>;
}

function RegisterScreen() {
  const [form, setForm] = useState({ fullName: '', email: '', rollNo: '', password: '', confirmation: '' }); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const navigate = useNavigate();
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: typeof value === 'string' ? value : value.target.value }));
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!meetsPolicy(form.password)) { setError(passwordRule); return; }
    if (form.password !== form.confirmation) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try { const result = await registerAccount({ fullName: form.fullName, email: form.email, rollNo: form.rollNo || undefined, password: form.password }); setMessage(result.message); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }
  return <AuthFrame kicker="STUDENT REGISTRATION" title={message ? <>You're<br/>registered.</> : <>Create your<br/>student account.</>} description={message || 'An administrator reviews every registration, then enrolls you in your courses.'}><form className="auth-fields" onSubmit={submit}>{!message && <><label>Full name<input value={form.fullName} onChange={set('fullName')} required minLength="2" maxLength="100" autoComplete="name"/></label><label>Email<input type="email" value={form.email} onChange={set('email')} required maxLength="254" autoComplete="email" placeholder="you@school.edu"/></label><label>Roll number (optional)<input value={form.rollNo} onChange={set('rollNo')} maxLength="50"/></label><PasswordField label="Password" value={form.password} onChange={set('password')} minLength="10" autoComplete="new-password"/><PasswordStrength value={form.password}/><PasswordField label="Confirm password" value={form.confirmation} onChange={set('confirmation')} minLength="10" autoComplete="new-password"/>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" disabled={loading}>{loading ? 'Submitting...' : 'Request an account'}<ArrowRight size={15}/></button></>}<button type="button" className="forgot-link" onClick={() => navigate('/')}>Back to sign in</button></form></AuthFrame>;
}

function ForgotPasswordScreen() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault(); setLoading(true); setError('');
    try { await requestPasswordReset(email); setSent(true); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }
  return <AuthFrame kicker="ACCOUNT RECOVERY" title={sent ? <>Check your<br/>inbox.</> : <>Reset your<br/>password.</>} description={sent ? 'If an account exists for that email, reset instructions are on the way. The link expires in one hour.' : 'Enter your email and we will send a secure reset link.'}><form className="auth-fields" onSubmit={submit}>{!sent && <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@school.edu"/></label>}{error && <div className="auth-error" role="alert">{error}</div>}{!sent && <button className="button-primary" disabled={loading}>{loading ? 'Sending...' : 'Send reset link'}<ArrowRight size={15}/></button>}<button type="button" className="forgot-link" onClick={() => navigate('/')}>Back to sign in</button></form></AuthFrame>;
}

function ResetPasswordScreen() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const [accessToken] = useState(params.get('access_token'));
  const linkError = params.get('error_description');
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [message, setMessage] = useState(''); const [error, setError] = useState(linkError || (!accessToken ? 'This reset link is invalid or expired. Request a new one.' : '')); const [loading, setLoading] = useState(false); const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!meetsPolicy(password)) { setError(passwordRule); return; }
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try { const result = await resetPassword(accessToken, password); setMessage(result.message); window.history.replaceState(null, '', '/reset-password'); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }
  if (!accessToken && !message) return <AuthFrame kicker="SECURE YOUR ACCOUNT" title={<>This link has<br/>expired.</>} description={error}><div className="auth-fields"><button type="button" className="button-primary" onClick={() => navigate('/forgot-password')}>Request a new link <ArrowRight size={15}/></button><button type="button" className="forgot-link" onClick={() => navigate('/')}>Back to sign in</button></div></AuthFrame>;
  return <AuthFrame kicker="SECURE YOUR ACCOUNT" title={<>Choose a new<br/>password.</>} description={message || passwordRule}><form className="auth-fields" onSubmit={submit}>{!message && <><PasswordField label="New password" value={password} onChange={setPassword} minLength="10" autoComplete="new-password"/><PasswordStrength value={password}/><PasswordField label="Confirm password" value={confirmation} onChange={setConfirmation} minLength="10" autoComplete="new-password"/></>}{error && <div className="auth-error" role="alert">{error}{/expired|invalid/i.test(error) && <> <button type="button" className="forgot-link" onClick={() => navigate('/forgot-password')}>Request a new link</button></>}</div>}{message ? <button type="button" className="button-primary" onClick={() => navigate('/')}>Return to sign in</button> : <button className="button-primary" disabled={loading}>{loading ? 'Updating...' : 'Update password'}<ArrowRight size={15}/></button>}</form></AuthFrame>;
}

export function PasswordChangeScreen({ onComplete }) {
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!meetsPolicy(newPassword)) { setError(passwordRule); return; }
    if (newPassword !== confirmation) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try { await changePassword(currentPassword, newPassword); await onComplete(); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }
  return <AuthFrame kicker="ONE QUICK STEP" title={<>Set a new<br/>password.</>} description="Your temporary password must be changed before you continue. You will sign in again afterwards."><form className="auth-fields" onSubmit={submit}><PasswordField label="Temporary password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password"/><PasswordField label="New password" value={newPassword} onChange={setNewPassword} minLength="10" autoComplete="new-password"/><PasswordStrength value={newPassword}/><PasswordField label="Confirm new password" value={confirmation} onChange={setConfirmation} minLength="10" autoComplete="new-password"/>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" disabled={loading}>{loading ? 'Updating...' : 'Change password'}<ArrowRight size={15}/></button></form></AuthFrame>;
}

export { meetsPolicy, passwordRule, PasswordField, PasswordStrength };
