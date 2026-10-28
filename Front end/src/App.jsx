import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Bell, BookOpen, CalendarDays, Check, ChevronRight, CircleHelp, Compass, FileText, GraduationCap, LayoutDashboard, LogOut, Megaphone, Menu, MessageSquareText, MoreHorizontal, Plus, Search, Settings, X } from 'lucide-react';
import { apiRequest, changePassword, restoreSession, setSessionExpiredHandler, signOut as apiSignOut } from './lib/api.js';
import { isSupabaseConfigured } from './lib/realtime.js';
import { initials, relativeTime, roleLabel } from './lib/format.js';
import { brand } from './brand.js';
import { ErrorBoundary, ErrorNotice, Modal } from './components/ui.jsx';
import { AuthScreen, meetsPolicy, PasswordChangeScreen, PasswordField, PasswordStrength, passwordRule } from './features/AuthScreens.jsx';
import { Announcements, Assignments, Dashboard, Learning, NotFound, Profile, Schedule } from './features/HomePages.jsx';
import { AdminPage, ChatPage, ComplaintsPage, GradebookPage, MarksPage, QuizzesPage } from './features/WorkspacePages.jsx';
import CourseDetailPage from './features/CourseDetailPage.jsx';

const links = [
  { label: 'Overview', to: '/', icon: LayoutDashboard },
  { label: 'Courses', to: '/learning', icon: BookOpen },
  { label: 'Assignments', to: '/assignments', icon: FileText, badge: 'assignments' },
  { label: 'Quizzes', to: '/quizzes', icon: Check },
  { label: 'My marks', to: '/marks', icon: GraduationCap, roles: ['student'] },
  { label: 'Gradebook', to: '/gradebook', icon: GraduationCap, roles: ['admin', 'teacher'] },
  { label: 'Schedule', to: '/schedule', icon: CalendarDays },
  { label: 'Classroom chat', to: '/chat', icon: MessageSquareText },
  { label: 'Announcements', to: '/announcements', icon: Megaphone, badge: 'announcements' },
  { label: 'Support', to: '/complaints', icon: CircleHelp },
];
const titles = { '/': 'Overview', '/learning': 'Courses', '/assignments': 'Assignments', '/quizzes': 'Quizzes', '/marks': 'My marks', '/gradebook': 'Gradebook', '/schedule': 'Schedule', '/chat': 'Classroom chat', '/announcements': 'Announcements', '/complaints': 'Support', '/admin': 'Administration', '/profile': 'My profile' };
const colors = ['violet', 'mint', 'coral', 'sand'];

function toProfile(person) {
  return { id: person.id, name: person.full_name || person.email?.split('@')[0] || 'Member', title: person.job_title || '', email: person.email || '', department: person.department || '', role: person.role, rollNo: person.roll_no, createdAt: person.created_at };
}

function SetupScreen() {
  return <main className="auth-screen"><div className="auth-form-wrap setup-screen"><section className="auth-form"><span className="eyebrow"><span className="eyebrow-line"/> SETUP REQUIRED</span><h2>Connect {brand.name} to Supabase.</h2><p>The web app needs <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code> and <code>VITE_API_URL</code> in <code>Front end/.env.local</code>. Copy <code>.env.example</code>, fill in your project values, and restart <code>npm run dev</code>.</p><p>Never put the service-role key in the web app. It belongs only in <code>Back end/.env</code>.</p></section></div></main>;
}

function RequireRole({ profile, roles, children }) {
  return roles.includes(profile.role) ? children : <NotFound />;
}

function CourseRoute(props) {
  const { courseId } = useParams();
  return <CourseDetailPage key={courseId} courseId={courseId} {...props} />;
}

function NotificationMenu({ notifications, unreadAnnouncements, onClose, onMarkRead }) {
  const navigate = useNavigate(); const ref = useRef(null);
  useEffect(() => {
    const onClick = (event) => { if (ref.current && !ref.current.contains(event.target) && !event.target.closest('.notification-button')) onClose(); };
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onClick); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const unread = notifications.items.filter((item) => !item.read_at).length;
  return <div className="notification-menu" ref={ref} role="dialog" aria-label="Notifications">
    <div className="notification-menu-head"><b>Notifications</b>{unread > 0 && <button className="text-link" onClick={onMarkRead}>Mark all read</button>}</div>
    {unreadAnnouncements > 0 && <button className="notification-item notification-unread" onClick={() => { onClose(); navigate('/announcements'); }}><Megaphone size={15}/><span><b>{unreadAnnouncements} unread announcement{unreadAnnouncements === 1 ? '' : 's'}</b><small>Open the announcements feed</small></span></button>}
    {notifications.items.length ? notifications.items.slice(0, 8).map((item) => <button key={item.id} className={`notification-item ${item.read_at ? '' : 'notification-unread'}`} onClick={() => { onClose(); if (item.kind.startsWith('complaint')) navigate('/complaints'); }}><Bell size={15}/><span><b>{item.title}</b><small>{item.body}</small><small>{relativeTime(item.created_at)}</small></span></button>)
      : !unreadAnnouncements && <p className="notification-empty">You are all caught up.</p>}
  </div>;
}

function App() {
  const [session, setSession] = useState(undefined);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [profile, setProfile] = useState(null);
  const [courses, setCourses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [posts, setPosts] = useState([]);
  const [notifications, setNotifications] = useState({ items: [], unread: 0 });
  const [loadError, setLoadError] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState('');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const searchRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const flash = useCallback((text, tone = 'success') => setNotice({ text, tone }), []);
  useEffect(() => { if (!notice) return undefined; const timer = setTimeout(() => setNotice(null), 3200); return () => clearTimeout(timer); }, [notice]);

  useEffect(() => {
    setSessionExpiredHandler(() => { setSession(null); setProfile(null); flash('Your session expired. Please sign in again.', 'error'); });
    if (!isSupabaseConfigured) return undefined;
    let mounted = true;
    restoreSession().then((restored) => { if (mounted) { setSession(restored); setAuthLoading(false); } });
    return () => { mounted = false; };
  }, [flash]);

  const loadCourses = useCallback(async (role) => { const data = await apiRequest(`/courses?pageSize=100${role === 'admin' ? '&includeArchived=true' : ''}`); setCourses(data.courses || []); }, []);
  const loadTasks = useCallback(async () => { const data = await apiRequest('/assignments?pageSize=100'); setTasks(data.assignments || []); }, []);
  const loadPosts = useCallback(async () => { const data = await apiRequest('/announcements?pageSize=50'); setPosts(data.announcements || []); }, []);
  const loadNotifications = useCallback(async () => { const data = await apiRequest('/notifications'); setNotifications({ items: data.notifications || [], unread: data.unread || 0 }); }, []);

  const loadWorkspace = useCallback(async () => {
    setLoadError('');
    try {
      const me = await apiRequest('/me');
      const person = toProfile(me.profile);
      setProfile(person);
      await Promise.all([loadCourses(person.role), loadTasks(), loadPosts(), loadNotifications()]);
    } catch (error) { setLoadError(error.message); }
  }, [loadCourses, loadTasks, loadPosts, loadNotifications]);

  useEffect(() => { if (session && !session.user?.mustChangePassword) loadWorkspace(); }, [session, loadWorkspace]);
  useEffect(() => { if (!session || !profile) return undefined; const timer = setInterval(() => { loadNotifications().catch(() => {}); loadPosts().catch(() => {}); }, 60000); return () => clearInterval(timer); }, [session, profile, loadNotifications, loadPosts]);
  useEffect(() => {
    const onKey = (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setMobileOpen(false); setMenuOpen(false); }, [location.pathname]);
  useEffect(() => { document.title = `${titles[location.pathname] || (location.pathname.startsWith('/courses/') ? 'Course' : brand.name)} · ${brand.fullName}`; }, [location.pathname]);

  function openModal(name) { setFormError(''); setNewPassword(''); setConfirmPassword(''); setCurrentPassword(''); setModal(name); }
  async function run(action, success) {
    setSaving(true); setFormError('');
    try { await action(); setModal(''); if (success) flash(success); }
    catch (error) { setFormError(error.message); }
    finally { setSaving(false); }
  }
  const saveProfile = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(async () => { const { profile: saved } = await apiRequest('/profiles/me', { method: 'PATCH', body: JSON.stringify({ full_name: form.get('full_name'), job_title: form.get('job_title'), department: form.get('department') }) }); setProfile(toProfile(saved)); }, 'Your profile has been updated.'); };
  const updatePassword = (event) => {
    event.preventDefault();
    if (!meetsPolicy(newPassword)) { setFormError(passwordRule); return; }
    if (newPassword !== confirmPassword) { setFormError('The new passwords do not match.'); return; }
    run(async () => { await changePassword(currentPassword, newPassword); }, 'Your password has been changed. Other devices were signed out.');
  };
  const addCourse = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(async () => { const { course } = await apiRequest('/courses', { method: 'POST', body: JSON.stringify({ title: form.get('title'), code: form.get('code') || undefined, category: form.get('category') || 'General', description: form.get('description') || '', cover_color: form.get('cover_color'), status: 'draft' }) }); await loadCourses(profile.role); navigate(`/courses/${course.id}`); }, 'Course draft created. Publish it when it is ready for students.'); };
  const addAnnouncement = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); run(async () => { await apiRequest('/announcements', { method: 'POST', body: JSON.stringify({ title: form.get('title'), body: form.get('text'), course_id: form.get('course_id') || null, is_pinned: form.get('is_pinned') === 'on' }) }); await loadPosts(); }, 'Your announcement has been shared.'); };
  async function markAnnouncementsRead() { try { await apiRequest('/announcements/read', { method: 'POST', body: JSON.stringify({}) }); await loadPosts(); } catch (error) { flash(error.message, 'error'); } }
  async function markNotificationsRead() { try { await apiRequest('/notifications/read', { method: 'POST', body: JSON.stringify({}) }); await loadNotifications(); } catch (error) { flash(error.message, 'error'); } }
  async function signOut() { try { await apiSignOut(); } finally { setSession(null); setProfile(null); setCourses([]); setTasks([]); setPosts([]); navigate('/'); flash('You’re signed out.'); } }
  const refreshAfterSubmit = async (message) => { await Promise.all([loadTasks(), loadCourses(profile.role)]); flash(message); };
  const refreshPosts = async (message) => { await loadPosts(); if (message) flash(message); };

  if (!isSupabaseConfigured) return <SetupScreen />;
  if (authLoading) return <div className="auth-loading"><span className="spinner" aria-hidden="true" />Loading your workspace…</div>;
  if (!session) return <>{<AuthScreen onAuthenticated={setSession} />}{notice && <Toast notice={notice} onClose={() => setNotice(null)} />}</>;
  if (session.user?.mustChangePassword) return <PasswordChangeScreen onComplete={async () => { await apiSignOut(); setSession(null); flash('Password updated. Sign in with your new password.'); }} />;
  if (!profile) return <div className="auth-loading">{loadError ? <div className="setup-error"><ErrorNotice error={loadError} onRetry={loadWorkspace} /><button className="button-quiet" onClick={signOut}>Sign out</button></div> : <><span className="spinner" aria-hidden="true" />Loading your workspace…</>}</div>;

  const staff = ['admin', 'teacher'].includes(profile.role);
  const unreadAnnouncements = posts.filter((post) => !post.is_read).length;
  const badges = {
    assignments: staff ? tasks.reduce((sum, task) => sum + (task.submissions || []).filter((submission) => submission.status === 'submitted').length, 0) : tasks.filter((task) => !task.my_submission && (new Date(task.due_at) > new Date() || task.allow_late)).length,
    announcements: unreadAnnouncements,
  };
  const visibleLinks = links.filter((item) => !item.roles || item.roles.includes(profile.role)).map((item) => item.to === '/learning' ? { ...item, label: profile.role === 'student' ? 'My courses' : profile.role === 'teacher' ? 'My classes' : 'Courses' } : item);
  const activeCourses = courses.filter((course) => !course.is_archived);
  const page = titles[location.pathname] || (location.pathname.startsWith('/courses/') ? 'Course details' : 'Not found');
  const pageProps = { profile, courses, tasks };

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="Sidebar">
      <div className="sidebar-top"><NavLink className="brand" to="/"><span className="brand-mark"><Compass size={22} strokeWidth={2.3} /></span><span>{brand.wordmark}<span className="brand-period">.</span><small>{brand.descriptor}</small></span></NavLink><button className="sidebar-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18}/></button></div>
      <div className="workspace-card"><span className="workspace-symbol">{roleLabel(profile.role)[0]}</span><span><b>{roleLabel(profile.role)}</b><small>{profile.department || brand.fullName}</small></span></div>
      <div className="nav-section-label">YOUR SPACE</div>
      <nav className="main-nav" aria-label="Main navigation">{visibleLinks.map(({ label, to, icon: Icon, badge }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{badge && badges[badge] > 0 && <span className="nav-badge" aria-label={`${badges[badge]} pending`}>{badges[badge]}</span>}</NavLink>)}
        {profile.role === 'admin' && <NavLink to="/admin" className={({ isActive }) => `nav-link admin-nav-link ${isActive ? 'nav-active' : ''}`}><Settings size={18}/><span>Administration</span></NavLink>}</nav>
      <div className="nav-section-label courses-label">{profile.role === 'student' ? 'MY COURSES' : 'COURSES'} {profile.role === 'admin' && <button aria-label="Create course" onClick={() => openModal('course')}><Plus size={15} /></button>}</div>
      <div className="course-nav">{activeCourses.length ? activeCourses.slice(0, 5).map((course) => <NavLink key={course.id} to={`/courses/${course.id}`} className={({ isActive }) => isActive ? 'course-nav-active' : ''}><span className={`course-dot ${course.cover_color || 'violet'}`} />{course.title}</NavLink>) : <small className="course-nav-empty">No courses yet</small>}</div>
      <div className="sidebar-spacer" />
      <NavLink className="sidebar-help" to="/complaints"><CircleHelp size={17} /> Help & support <ArrowUpRight size={14} /></NavLink>
      <NavLink className="sidebar-profile" to="/profile"><span className="avatar avatar-photo">{initials(profile.name)}</span><span className="profile-meta"><b>{profile.name}</b><small>{profile.email}</small></span><MoreHorizontal size={18} /></NavLink><button className="sidebar-signout" onClick={signOut}><LogOut size={15}/> Sign out</button>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

    <main className="main-area" id="main-content">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><div className="breadcrumbs"><span>{brand.name}</span><ChevronRight size={14} /><b>{page}</b></div></div><div className="topbar-actions"><label className="search-box"><Search size={16} /><input ref={searchRef} placeholder="Search courses..." aria-label="Search courses" value={query} onChange={(event) => { setQuery(event.target.value); if (location.pathname !== '/learning') navigate('/learning'); }} />{query ? <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={12}/></button> : <kbd>Ctrl K</kbd>}</label><div className="notification-wrap"><button className="icon-button notification-button" aria-label={`Notifications${notifications.unread + unreadAnnouncements ? `, ${notifications.unread + unreadAnnouncements} unread` : ''}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Bell size={18} />{notifications.unread + unreadAnnouncements > 0 && <i />}</button>{menuOpen && <NotificationMenu notifications={notifications} unreadAnnouncements={unreadAnnouncements} onClose={() => setMenuOpen(false)} onMarkRead={markNotificationsRead} />}</div><span className="topbar-divider" /><NavLink className="top-avatar" aria-label="Open profile" to="/profile">{initials(profile.name)}</NavLink></div></header>
      <div className="content-wrap">
        {loadError && <ErrorNotice error={loadError} onRetry={loadWorkspace} />}
        <ErrorBoundary resetKey={location.pathname}>
          <Routes>
            <Route path="/" element={<Dashboard {...pageProps} posts={posts} onAddCourse={() => openModal('course')} onSubmitted={refreshAfterSubmit} />} />
            <Route path="/learning" element={<Learning profile={profile} courses={courses} query={query} onAddCourse={() => openModal('course')} />} />
            <Route path="/courses/:courseId" element={<CourseRoute profile={profile} onCoursesChanged={() => loadCourses(profile.role)} onTasksChanged={loadTasks} flash={flash} />} />
            <Route path="/assignments" element={<Assignments {...pageProps} onSubmitted={refreshAfterSubmit} />} />
            <Route path="/quizzes" element={<QuizzesPage courses={activeCourses} profile={profile} />} />
            <Route path="/marks" element={<RequireRole profile={profile} roles={['student']}><MarksPage /></RequireRole>} />
            <Route path="/gradebook" element={<RequireRole profile={profile} roles={['admin', 'teacher']}><GradebookPage courses={activeCourses} onGraded={loadTasks} /></RequireRole>} />
            <Route path="/schedule" element={<Schedule profile={profile} tasks={tasks} />} />
            <Route path="/chat" element={<ChatPage courses={activeCourses} profile={profile} />} />
            <Route path="/announcements" element={<Announcements profile={profile} posts={posts} courses={courses} onNew={() => openModal('announcement')} onMarkRead={markAnnouncementsRead} onChanged={refreshPosts} />} />
            <Route path="/messages" element={<Navigate to="/announcements" replace />} />
            <Route path="/complaints" element={<ComplaintsPage profile={profile} courses={activeCourses} onChanged={loadNotifications} />} />
            <Route path="/admin" element={<RequireRole profile={profile} roles={['admin']}><AdminPage profile={profile} /></RequireRole>} />
            <Route path="/profile" element={<Profile {...pageProps} onEdit={() => openModal('profile')} onChangePassword={() => openModal('password')} />} />
            <Route path="/reset-password" element={<Navigate to="/profile" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </div>
      <footer className="footer"><span>© {new Date().getFullYear()} {brand.fullName}</span><span>Signed in as {roleLabel(profile.role).toLowerCase()}</span></footer>
    </main>

    {modal === 'course' && <Modal title="Create a course" onClose={() => setModal('')}><form className="modal-form" onSubmit={addCourse}><p className="modal-intro">New courses start as drafts. Students only see a course after you publish it.</p><label>Course name<input name="title" placeholder="e.g. Introduction to Programming" minLength="2" maxLength="120" required autoFocus /></label><div className="admin-form-row"><label>Course code<input name="code" placeholder="e.g. CS101" pattern="[A-Za-z0-9\-]{2,24}" title="2 to 24 letters, numbers or dashes" /></label><label>Category<input name="category" list="course-categories" placeholder="General" maxLength="80" /></label></div><datalist id="course-categories">{[...new Set(courses.map((course) => course.category))].map((category) => <option key={category} value={category} />)}</datalist><label>Description<textarea name="description" rows="3" maxLength="2000" placeholder="What will students learn?" /></label><label>Colour<select name="cover_color" defaultValue="violet">{colors.map((color) => <option key={color} value={color}>{color[0].toUpperCase() + color.slice(1)}</option>)}</select></label><ErrorNotice error={formError} /><div className="modal-actions"><button type="button" className="button-quiet" onClick={() => setModal('')}>Cancel</button><button className="button-primary" disabled={saving}><Plus size={15} /> {saving ? 'Creating…' : 'Create course'}</button></div></form></Modal>}
    {modal === 'profile' && <Modal title="Edit your profile" onClose={() => setModal('')}><form className="modal-form" onSubmit={saveProfile}><label>Full name<input name="full_name" defaultValue={profile.name} minLength="2" maxLength="100" required /></label><label>Job title<input name="job_title" defaultValue={profile.title} maxLength="100" /></label><label>Email<input type="email" value={profile.email} readOnly aria-describedby="email-note" /></label><small id="email-note" className="field-note">Ask an administrator to change your email address.</small><label>Department<input name="department" defaultValue={profile.department} maxLength="100" /></label><ErrorNotice error={formError} /><div className="modal-actions"><button type="button" className="button-quiet" onClick={() => setModal('')}>Cancel</button><button className="button-primary" disabled={saving}><Check size={15} /> {saving ? 'Saving…' : 'Save profile'}</button></div></form></Modal>}
    {modal === 'password' && <Modal title="Change your password" onClose={() => setModal('')}><form className="modal-form" onSubmit={updatePassword}><p className="modal-intro">{passwordRule} Your other devices will be signed out.</p><PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" /><PasswordField label="New password" value={newPassword} onChange={setNewPassword} minLength="10" autoComplete="new-password" /><PasswordStrength value={newPassword} /><PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} minLength="10" autoComplete="new-password" /><ErrorNotice error={formError} /><div className="modal-actions"><button type="button" className="button-quiet" onClick={() => setModal('')}>Cancel</button><button className="button-primary" disabled={saving}><Check size={15}/> {saving ? 'Updating…' : 'Update password'}</button></div></form></Modal>}
    {modal === 'announcement' && <Modal title="New announcement" onClose={() => setModal('')}><form className="modal-form" onSubmit={addAnnouncement}><label>Headline<input name="title" required minLength="2" maxLength="160" placeholder="What should everyone know?" /></label><label>Message<textarea name="text" required rows="5" maxLength="5000" placeholder="Add the details..." /></label><label>Audience<select name="course_id" required={profile.role !== 'admin'} defaultValue="">{profile.role === 'admin' ? <option value="">Everyone</option> : <option value="" disabled>Choose one of your courses</option>}{activeCourses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" name="is_pinned"/> Pin to the top of the feed</label><ErrorNotice error={formError} /><div className="modal-actions"><button type="button" className="button-quiet" onClick={() => setModal('')}>Cancel</button><button className="button-primary" disabled={saving}><ArrowRight size={15} /> {saving ? 'Posting…' : 'Post announcement'}</button></div></form></Modal>}
    {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
  </div>;
}

function Toast({ notice, onClose }) {
  return <div className={`toast ${notice.tone === 'error' ? 'toast-error' : ''}`} role="status"><span className="toast-check">{notice.tone === 'error' ? <X size={15} /> : <Check size={15} />}</span>{notice.text}<button onClick={onClose} aria-label="Dismiss"><X size={14} /></button></div>;
}

export default App;
