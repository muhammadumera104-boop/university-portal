import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Compass, FileText, GraduationCap, Megaphone, Plus, Settings, Sparkles, Trash2, Users } from 'lucide-react';
import { apiRequest } from '../lib/api.js';
import { assignmentStatus, formatDate, formatDateTime, initials, relativeTime, roleLabel } from '../lib/format.js';
import { EmptyState, StatusPill } from '../components/ui.jsx';
import SubmissionDialog from './SubmissionDialog.jsx';

const DAY = 86400000;
const isStaff = (profile) => ['admin', 'teacher'].includes(profile.role);
const openForStudent = (task) => !task.my_submission && (new Date(task.due_at) > new Date() || task.allow_late);
const awaitingGrade = (task) => (task.submissions || []).filter((submission) => submission.status === 'submitted').length;
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; };
const pad = (value) => String(value).padStart(2, '0');

function Metric({ icon: Icon, label, value, detail, color }) {
  return <div className="metric-card"><div className="metric-top"><span className={`metric-icon metric-${color}`}><Icon size={17} /></span></div><div className="metric-number">{value}</div><div className="metric-bottom"><b>{label}</b><small>{detail}</small></div></div>;
}

function CourseRow({ course, onClick, index, student }) {
  return <button className="course-row" onClick={onClick}><div className={`course-thumbnail thumb-${course.cover_color || 'violet'}`}><span className="thumb-index">{pad(index + 1)}</span><span className="thumb-mark">✳</span><span className="thumb-label">{course.category}</span></div><div className="course-row-info"><div className="course-row-title"><b>{course.title}</b>{student && <span className="course-progress-label">{course.progress}%</span>}</div><div className="course-instructor">{course.teachers?.length ? course.teachers.join(', ') : 'No teacher assigned yet'}<span className="bullet-dot">·</span>{course.lesson_count} lessons</div>{student ? <div className="progress-track"><span className={`progress-${course.cover_color || 'violet'}`} style={{ width: `${course.progress}%` }} /></div> : <small className="course-row-meta">{course.student_count} students · {course.status}</small>}</div><ArrowRight className="course-row-arrow" size={16} /></button>;
}

function TaskRow({ task, student, onSubmit }) {
  const status = student ? assignmentStatus(task) : `${awaitingGrade(task)} to grade`;
  return <div className="task-row">{student && openForStudent(task) ? <button className="task-check" onClick={() => onSubmit(task)} aria-label={`Submit ${task.title}`}><Check size={13} /></button> : <span className="task-check task-check-static" aria-hidden="true"><FileText size={12} /></span>}<div className="task-copy"><b>{task.title}</b><span>{task.course?.title || 'Course'}</span></div><div className="task-due"><span className={status === 'Due soon' || status === 'Overdue' ? 'due-soon' : ''}>{status}</span><small><Clock3 size={11} />{formatDateTime(task.due_at)}</small></div></div>;
}

export function Dashboard({ profile, courses, tasks, posts, onAddCourse, onSubmitted }) {
  const navigate = useNavigate(); const [submitting, setSubmitting] = useState(null);
  const student = profile.role === 'student';
  const active = courses.filter((course) => !course.is_archived);
  const now = Date.now();
  const open = tasks.filter(openForStudent).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const dueThisWeek = open.filter((task) => new Date(task.due_at) - now < 7 * DAY);
  const submitted = tasks.filter((task) => task.my_submission);
  const graded = submitted.filter((task) => task.my_submission.status === 'graded');
  const toGrade = tasks.reduce((sum, task) => sum + awaitingGrade(task), 0);
  const students = active.reduce((sum, course) => sum + (course.student_count || 0), 0);
  const upcoming = student ? open : tasks.filter((task) => new Date(task.due_at) > now || awaitingGrade(task)).sort((a, b) => awaitingGrade(b) - awaitingGrade(a) || new Date(a.due_at) - new Date(b.due_at));
  const averageProgress = active.length ? Math.round(active.reduce((sum, course) => sum + (course.progress || 0), 0) / active.length) : 0;
  const unread = posts.filter((post) => !post.is_read).length;
  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
  const summary = student
    ? <>You have <b>{dueThisWeek.length}</b> assignment{dueThisWeek.length === 1 ? '' : 's'} due in the next 7 days and <b>{unread}</b> unread announcement{unread === 1 ? '' : 's'}.</>
    : <>There {toGrade === 1 ? 'is' : 'are'} <b>{toGrade}</b> submission{toGrade === 1 ? '' : 's'} waiting for a grade across <b>{active.length}</b> course{active.length === 1 ? '' : 's'}.</>;
  return <div className="dashboard-page">
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> {today}</div><h1>{greeting()}, <span>{profile.name.split(' ')[0]}.</span></h1><p className="welcome-subtitle">{student ? 'Here is what needs your attention.' : `Your ${roleLabel(profile.role).toLowerCase()} workspace at a glance.`}</p></div>{profile.role === 'admin' && <button className="button-primary create-button" onClick={onAddCourse}><Plus size={16} /> Create a course</button>}</section>
    <section className="hero-card"><div className="hero-content"><div className="hero-kicker"><span className="live-pill"><i /> {student ? 'YOUR WEEK AHEAD' : 'WHAT NEEDS ATTENTION'}</span></div><h2>Small steps.<br /><em>Remarkable progress.</em></h2><p>{summary}</p><button className="hero-link" onClick={() => navigate(student ? '/assignments' : '/gradebook')}>{student ? 'Open your assignments' : 'Open the gradebook'} <ArrowRight size={15} /></button></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><div className="orbit-core"><Compass size={33} strokeWidth={1.2} /></div><div className="orbit-star star-a">✳</div><div className="orbit-star star-b">✦</div><div className="orbit-star star-c">·</div><div className="orbit-label label-a">COURSES <b>{pad(active.length)}</b></div><div className="orbit-label label-b">{student ? 'DUE SOON' : 'TO GRADE'} <b>{pad(student ? dueThisWeek.length : toGrade)}</b></div></div></section>
    <section className="metric-grid">{student ? <>
      <Metric icon={GraduationCap} label="Enrolled courses" value={pad(active.length)} detail="published and active" color="purple" />
      <Metric icon={Clock3} label="Due this week" value={pad(dueThisWeek.length)} detail="not yet submitted" color="amber" />
      <Metric icon={Check} label="Submitted" value={pad(submitted.length)} detail={`${graded.length} graded so far`} color="teal" />
      <Metric icon={BookOpen} label="Average progress" value={`${averageProgress}%`} detail="lessons completed" color="rose" />
    </> : <>
      <Metric icon={GraduationCap} label={profile.role === 'admin' ? 'Active courses' : 'Your classes'} value={pad(active.length)} detail={`${courses.filter((course) => course.status === 'published' && !course.is_archived).length} published`} color="purple" />
      <Metric icon={Users} label="Enrolled students" value={pad(students)} detail="across these courses" color="teal" />
      <Metric icon={FileText} label="Assignments" value={pad(tasks.length)} detail={`${tasks.filter((task) => new Date(task.due_at) > now).length} still open`} color="amber" />
      <Metric icon={Check} label="Awaiting grade" value={pad(toGrade)} detail="submitted, not graded" color="rose" />
    </>}</section>
    <section className="dashboard-grid">
      <div className="panel learning-panel"><div className="panel-heading"><div><div className="section-overline">{student ? 'KEEP YOUR MOMENTUM' : 'YOUR COURSES'}</div><h3>{student ? 'Pick up where you left off' : 'Courses at a glance'}</h3></div><button className="text-link" onClick={() => navigate('/learning')}>All courses <ArrowRight size={14} /></button></div>{active.length ? <div className="course-list">{active.slice(0, 3).map((course, i) => <CourseRow key={course.id} course={course} index={i} student={student} onClick={() => navigate(`/courses/${course.id}`)} />)}</div> : <EmptyState title="No courses yet" body={student ? 'Courses you are enrolled in appear here once they are published.' : profile.role === 'admin' ? 'Create your first course to get started.' : 'An administrator will assign you to courses.'} />}</div>
      <div className="panel tasks-panel"><div className="panel-heading"><div><div className="section-overline">ON YOUR RADAR</div><h3>{student ? 'Upcoming assignments' : 'Assignments'} <span className="count-pill">{upcoming.length}</span></h3></div></div>{upcoming.length ? <div className="task-list">{upcoming.slice(0, 5).map((task) => <TaskRow key={task.id} task={task} student={student} onSubmit={setSubmitting} />)}</div> : <EmptyState title="All caught up" body={student ? 'Nothing is waiting for you right now.' : 'No open assignments or submissions to grade.'} />}<button className="panel-bottom-link" onClick={() => navigate('/assignments')}>View all assignments <ArrowRight size={14} /></button></div>
      <div className="panel activity-panel"><div className="panel-heading"><div><div className="section-overline">{student ? 'YOUR PROGRESS' : 'ENROLLMENT'}</div><h3>{student ? 'Lessons completed' : 'Students per course'}</h3></div></div>{active.length ? <div className="progress-list">{active.slice(0, 6).map((course) => { const value = student ? course.progress : course.student_count; const max = student ? 100 : Math.max(1, ...active.map((item) => item.student_count || 0)); return <div className="progress-list-row" key={course.id}><span>{course.title}</span><b>{student ? `${value}%` : value}</b><div className="progress-track"><span className={`progress-${course.cover_color || 'violet'}`} style={{ width: `${Math.round((value || 0) / max * 100)}%` }} /></div></div>; })}</div> : <EmptyState title="Nothing to show yet" body="Progress appears once courses have lessons." />}</div>
      <div className="panel community-panel"><div className="panel-heading"><div><div className="section-overline">LATEST NEWS</div><h3>Announcements {unread > 0 && <span className="count-pill">{unread} new</span>}</h3></div></div>{posts.length ? <div className="community-list">{posts.slice(0, 3).map((post) => <button className="community-item" onClick={() => navigate('/announcements')} key={post.id}><span className="avatar avatar-violet">{initials(post.author_name)}</span><span className="community-copy"><b>{post.title}</b><small>{post.author_name} · {relativeTime(post.created_at)}</small></span><ChevronRight size={15} /></button>)}</div> : <EmptyState title="No announcements yet" body="Updates from your teachers and administrators appear here." icon={Megaphone} />}<button className="panel-bottom-link" onClick={() => navigate('/announcements')}>All announcements <ArrowRight size={14} /></button></div>
    </section>
    {submitting && <SubmissionDialog assignment={submitting} onClose={() => setSubmitting(null)} onSubmitted={async () => { setSubmitting(null); await onSubmitted('Your assignment has been submitted.'); }} />}
  </div>;
}

export function Learning({ profile, courses, query, onAddCourse }) {
  const navigate = useNavigate(); const [filter, setFilter] = useState('All courses'); const [showArchived, setShowArchived] = useState(false);
  const student = profile.role === 'student';
  const visible = courses.filter((course) => showArchived || !course.is_archived);
  const categories = ['All courses', ...new Set(visible.map((course) => course.category))];
  const filtered = visible.filter((course) => `${course.title} ${course.category} ${course.code}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All courses' || course.category === filter));
  const lessons = visible.reduce((sum, course) => sum + course.lesson_count, 0);
  const title = student ? 'My courses' : profile.role === 'teacher' ? 'My classes' : 'Courses';
  return <div className="subpage"><div className="subpage-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {student ? 'YOUR LEARNING' : 'YOUR TEACHING'}</div><h1>{title}</h1><p>{student ? 'Every course you are enrolled in, in one place.' : profile.role === 'admin' ? 'Every course in the workspace, including drafts.' : 'The courses you are assigned to teach.'}</p></div>{profile.role === 'admin' && <button className="button-primary" onClick={onAddCourse}><Plus size={16} /> Create a course</button>}</div>
    <div className="learning-overview"><div><span className="overview-label">COURSES</span><b>{pad(visible.filter((course) => !course.is_archived).length)} <small>active</small></b></div><div className="overview-line"/><div><span className="overview-label">LESSONS</span><b>{pad(lessons)} <small>in total</small></b></div><div className="overview-line"/><div>{student ? <><span className="overview-label">AVERAGE PROGRESS</span><b>{visible.length ? Math.round(visible.reduce((sum, course) => sum + course.progress, 0) / visible.length) : 0}% <small>complete</small></b></> : <><span className="overview-label">STUDENTS</span><b>{pad(visible.reduce((sum, course) => sum + (course.student_count || 0), 0))} <small>enrolled</small></b></>}</div><Sparkles size={21} /></div>
    <div className="filters-row"><div className="filter-pills">{categories.map((item) => <button key={item} className={filter === item ? 'filter-active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>{profile.role === 'admin' && <label className="checkbox-label"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>}</div>
    {query && <p className="search-summary">Showing results for “{query}”.</p>}
    <div className="learning-cards">{filtered.map((course, i) => <article className="learning-card" key={course.id}><div className={`learning-cover thumb-${course.cover_color || 'violet'}`}><span className="cover-number">{pad(i + 1)} <i>— {course.code}</i></span><span className="cover-art">✳</span><span className="cover-bottom"><span>{course.category}</span><span>{course.lesson_count} lessons</span></span></div><div className="learning-card-body"><div className="learning-card-title"><h3>{course.title}</h3>{!student && <StatusPill>{course.is_archived ? 'Archived' : course.status}</StatusPill>}</div><div className="course-instructor">{course.teachers?.length ? course.teachers.join(', ') : 'No teacher assigned yet'}</div>{student ? <div className="learning-card-progress"><div><span>Your progress</span><b>{course.progress}%</b></div><div className="progress-track"><span className={`progress-${course.cover_color || 'violet'}`} style={{ width: `${course.progress}%` }} /></div></div> : <div className="learning-card-progress"><div><span>{course.student_count} students · {course.module_count} modules</span></div></div>}<button className="continue-button" onClick={() => navigate(`/courses/${course.id}`)}>{student ? 'Continue learning' : 'Open course'} <ArrowRight size={15} /></button></div></article>)}</div>
    {!filtered.length && <div className="panel"><EmptyState title={query ? 'No courses match your search' : courses.length ? 'Nothing in this category' : 'No courses yet'} body={query ? 'Try a different word, or clear the search box.' : student ? 'You will see courses here once an administrator enrolls you and the course is published.' : profile.role === 'admin' ? 'Create a course to get started.' : 'An administrator will assign you to courses.'} /></div>}
  </div>;
}

export function Assignments({ profile, tasks, courses, onSubmitted }) {
  const navigate = useNavigate(); const [courseId, setCourseId] = useState(''); const [submitting, setSubmitting] = useState(null);
  const student = profile.role === 'student';
  const now = Date.now();
  const list = tasks.filter((task) => !courseId || task.course_id === courseId).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const open = list.filter(openForStudent);
  const stats = student
    ? [['TO DO', open.length], ['DUE THIS WEEK', open.filter((task) => new Date(task.due_at) - now < 7 * DAY).length], ['SUBMITTED', list.filter((task) => task.my_submission).length]]
    : [['ASSIGNMENTS', list.length], ['STILL OPEN', list.filter((task) => new Date(task.due_at) > now).length], ['TO GRADE', list.reduce((sum, task) => sum + awaitingGrade(task), 0)]];
  return <div className="subpage"><div className="subpage-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> MAKE SPACE TO FOCUS</div><h1>Assignments</h1><p>{student ? 'Everything due across your courses, soonest first.' : 'Assignments across your courses and what is waiting to be graded.'}</p></div><select className="course-select" value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Filter by course"><option value="">All courses</option>{courses.filter((course) => !course.is_archived).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></div>
    <div className="assignment-stats">{stats.map(([label, value]) => <div key={label}><span>{label}</span><b>{pad(value)}</b></div>)}<div className="assignment-quote"><Sparkles size={19} /><span>“Progress is built one<br /> honest attempt at a time.”</span></div></div>
    <div className="panel assignment-panel"><div className="panel-heading"><div><div className="section-overline">{student ? 'YOUR WORK QUEUE' : 'COURSE WORK'}</div><h3>All assignments <span className="count-pill">{list.length}</span></h3></div></div>{list.length ? <div className="assignment-list">{list.map((task) => { const status = student ? assignmentStatus(task) : `${awaitingGrade(task)} to grade`; return <div className="assignment-item" key={task.id}><div className="assignment-type violet"><FileText size={17} /></div><div className="assignment-info"><span>{task.course?.title || 'Course'}</span><b>{task.title}</b><small><CalendarDays size={12} /> Due {formatDateTime(task.due_at)} · {task.max_marks} marks{student && task.my_submission?.status === 'graded' ? ` · Scored ${task.my_submission.marks_obtained}` : ''}</small>{student && task.my_submission?.feedback && <small className="assignment-feedback">Feedback: {task.my_submission.feedback}</small>}</div><StatusPill>{status}</StatusPill>{student && (openForStudent(task) || (task.my_submission && task.my_submission.status !== 'graded' && (new Date(task.due_at) > new Date() || task.allow_late))) && <button className="button-quiet compact-button" onClick={() => setSubmitting(task)}>{task.my_submission ? 'Resubmit' : 'Submit work'}</button>}{!student && <button className="button-quiet compact-button" onClick={() => navigate(`/gradebook?course=${task.course_id}`)}>Grade</button>}</div>; })}</div> : <EmptyState title={student ? 'A clear runway' : 'No assignments yet'} body={student ? 'There are no assignments in your courses right now.' : 'Create assignments from a course page.'} />}</div>
    {submitting && <SubmissionDialog assignment={submitting} onClose={() => setSubmitting(null)} onSubmitted={async () => { setSubmitting(null); await onSubmitted('Your assignment has been submitted.'); }} />}
  </div>;
}

function startOfWeek(offset) {
  const date = new Date(); date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + offset * 7);
  return date;
}

export function Schedule({ profile, tasks }) {
  const [offset, setOffset] = useState(0);
  const student = profile.role === 'student';
  const start = startOfWeek(offset);
  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY));
  const todayKey = new Date().toDateString();
  const eventClass = (task) => { const status = student ? assignmentStatus(task) : ''; return status.startsWith('Submitted') || status === 'Graded' ? 'event-violet' : status === 'Overdue' || status === 'Missed' ? 'event-coral' : 'event-mint'; };
  const end = new Date(start.getTime() + 7 * DAY);
  const inWeek = tasks.filter((task) => { const due = new Date(task.due_at); return due >= start && due < end; });
  return <div className="subpage"><div className="subpage-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> MAKE TIME FOR WHAT MATTERS</div><h1>Your schedule</h1><p>Assignment deadlines across your courses, week by week.</p></div><button className="button-quiet outline-button" onClick={() => setOffset(0)} disabled={offset === 0}>Back to this week</button></div>
    <div className="schedule-card"><div className="schedule-month"><div><span>{start.toLocaleDateString([], { month: 'long', year: 'numeric' }).toUpperCase()}</span><h2>{offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : `Week of ${formatDate(start)}`} <small className="count-pill">{inWeek.length} due</small></h2></div><div className="schedule-arrows"><button aria-label="Previous week" onClick={() => setOffset(offset - 1)}><ChevronLeft size={17} /></button><button aria-label="Next week" onClick={() => setOffset(offset + 1)}><ChevronRight size={17} /></button></div></div>
      <div className="week-grid">{days.map((day) => { const due = tasks.filter((task) => new Date(task.due_at).toDateString() === day.toDateString()); return <div className={`day-column ${day.toDateString() === todayKey ? 'day-today' : ''}`} key={day.toISOString()}><span>{day.toLocaleDateString([], { weekday: 'short' }).toUpperCase()}</span><b>{pad(day.getDate())}</b>{due.map((task) => <div className={`day-event ${eventClass(task)}`} key={task.id} title={`${task.title} — ${task.course?.title || ''}`}><small>{new Date(task.due_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>{task.title}</div>)}</div>; })}</div>
      <div className="schedule-foot">{student ? <><span><i className="event-legend mint" /> Due</span><span><i className="event-legend violet" /> Submitted</span><span><i className="event-legend coral" /> Overdue or missed</span></> : <span><i className="event-legend mint" /> Assignment due</span>}</div></div>
    {!inWeek.length && <div className="schedule-note"><Sparkles size={17} /><span><b>Nothing due this week.</b> Use the arrows to look ahead.</span></div>}
  </div>;
}

export function Announcements({ profile, posts, courses, onNew, onMarkRead, onChanged }) {
  const [courseId, setCourseId] = useState(''); const [error, setError] = useState('');
  const staff = isStaff(profile);
  const list = posts.filter((post) => !courseId || (courseId === 'global' ? !post.course_id : post.course_id === courseId));
  const unreadCount = posts.filter((post) => !post.is_read).length;
  async function remove(post) {
    if (!window.confirm(`Delete “${post.title}”? This cannot be undone.`)) return;
    try { await apiRequest(`/announcements/${post.id}`, { method: 'DELETE' }); await onChanged('The announcement was deleted.'); }
    catch (reason) { setError(reason.message); }
  }
  return <div className="subpage"><div className="subpage-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> GOOD THINGS TRAVEL</div><h1>Announcements</h1><p>Workspace-wide news and updates from your courses. Pinned posts stay on top.</p></div>{staff && <button className="button-primary" onClick={onNew}><Plus size={16} /> New announcement</button>}</div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="message-layout"><div className="panel message-feed"><div className="panel-heading"><div><div className="section-overline">THE LATEST</div><h3>Updates <span className="count-pill">{list.length}</span></h3></div><div className="feed-controls"><select className="course-select" value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Filter announcements"><option value="">All announcements</option><option value="global">Everyone</option>{courses.filter((course) => !course.is_archived).map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select><button className="select-button" disabled={!unreadCount} onClick={onMarkRead}>{unreadCount ? `Mark ${unreadCount} read` : 'All caught up'}</button></div></div>
      {list.length ? list.map((post) => <article className="message-post" key={post.id}><span className="avatar avatar-violet">{initials(post.author_name)}</span><div className="post-content"><div className="post-byline"><b>{post.author_name}</b><span>{roleLabel(post.author_role)}</span><small title={formatDateTime(post.created_at)}>{relativeTime(post.created_at)}</small></div><h3>{post.is_pinned && <span className="post-pinned">PINNED: </span>}{post.title}{!post.is_read && <i className="post-unread" aria-label="Unread"/>}</h3><p>{post.body}</p><span className="post-tag">{post.course_title || 'Everyone'}</span></div>{(profile.role === 'admin' || post.author_id === profile.id) && <button className="post-options" aria-label={`Delete ${post.title}`} onClick={() => remove(post)}><Trash2 size={16} /></button>}</article>) : <EmptyState title="No announcements yet" body={staff ? 'Share the first update with your learners.' : 'Updates from your teachers and administrators will appear here.'} icon={Megaphone} />}
    </div><aside className="community-aside"><div className="aside-welcome"><div className="aside-sparkle"><Sparkles size={20} /></div><span>STAY IN THE LOOP</span><h3>{unreadCount ? `${unreadCount} unread update${unreadCount === 1 ? '' : 's'}` : 'You are all caught up.'}</h3><p>{staff ? (profile.role === 'admin' ? 'Admins can post to everyone or to a single course.' : 'Teachers post to the courses they teach.') : 'Announcements come from your administrators and the teachers of your courses.'}</p>{staff && <button onClick={onNew}>Write an announcement <ArrowRight size={14} /></button>}</div></aside></div>
  </div>;
}

export function Profile({ profile, courses, tasks, onEdit, onChangePassword }) {
  const student = profile.role === 'student';
  const active = courses.filter((course) => !course.is_archived);
  const submitted = tasks.filter((task) => task.my_submission);
  const snapshot = student
    ? [[pad(active.length), 'Courses'], [pad(submitted.length), 'Submitted'], [pad(submitted.filter((task) => task.my_submission.status === 'graded').length), 'Graded']]
    : [[pad(active.length), 'Courses'], [pad(tasks.length), 'Assignments'], [pad(tasks.reduce((sum, task) => sum + awaitingGrade(task), 0)), 'To grade']];
  return <div className="subpage"><div className="subpage-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR ACCOUNT</div><h1>My profile</h1><p>Your details and account security.</p></div><div className="profile-actions"><button className="button-quiet outline-button" onClick={onChangePassword}>Change password</button><button className="button-primary" onClick={onEdit}><Settings size={15} /> Edit profile</button></div></div>
    <section className="profile-hero"><div className="profile-cover"><div className="profile-cover-orbit"/><div className="profile-cover-star">✳</div></div><div className="profile-id"><span className="profile-large-avatar">{initials(profile.name)}</span><div><h2>{profile.name}</h2><span>{[profile.title, profile.department].filter(Boolean).join(' · ') || roleLabel(profile.role)}</span></div><span className="profile-active"><i/> {roleLabel(profile.role)}</span></div><div className="profile-details"><div><span>EMAIL</span><b>{profile.email}</b></div><div><span>{student ? 'ROLL NUMBER' : 'DEPARTMENT'}</span><b>{(student ? profile.rollNo : profile.department) || '—'}</b></div><div><span>MEMBER SINCE</span><b>{profile.createdAt ? new Date(profile.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' }) : '—'}</b></div></div></section>
    <div className="profile-bottom-grid"><div className="panel profile-progress"><div className="panel-heading"><div><div className="section-overline">AT A GLANCE</div><h3>Your snapshot</h3></div><Sparkles size={18} className="sparkle-muted" /></div><div className="snapshot-stats">{snapshot.map(([value, label]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}</div></div><div className="profile-note"><Sparkles size={18} /><h3>Curiosity looks good on you.</h3><p>Every hour you invest opens a new door. Keep following the questions that matter.</p></div></div>
  </div>;
}

export function NotFound() {
  const navigate = useNavigate();
  return <div className="subpage"><div className="panel"><EmptyState title="This page does not exist" body="The link may be out of date, or you may not have access to it."><button className="button-primary" onClick={() => navigate('/')}>Go to overview</button></EmptyState></div></div>;
}

