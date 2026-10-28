# LMS audit — 2026-10-26

Scope: every file in `Back end/` and `Front end/`, the Supabase migration, and the hosted Supabase project (read-only checks), measured against `Internal LMS – AI Build Spec`.

Live project state at audit time: schema applied, `resources` and `complaints` buckets exist and are private, **0 Auth users, 0 rows in every table**, hosted Auth **public signup enabled**.

## 1. Working

- Express API with Helmet, CORS allow-list, 1 MB body limit, global and per-route rate limits (login 5/15 min per IP+email, forgot-password 3/h, chat 20/min).
- Login / refresh (httpOnly cookie) / logout / forgot / reset / change password; generic login error; deactivated users rejected on every request; forced password change for temporary passwords.
- Admin account creation with one-time temporary password, activate/deactivate (self-deactivation blocked), admin-triggered reset email.
- Role middleware plus RLS on all 21 tables; quiz answer keys in a separate teacher/admin-only table; service-role key server-only (absent from the web bundle).
- Resource upload with magic-byte MIME check, 25 MB limit, private bucket, 60 s signed URLs.
- Assignment submission with server-side lateness (409 when late not allowed), grading with max-marks check (422), audit log entries.
- Quiz attempt flow: one attempt, server scoring, timer with 10 s grace, auto-submit on expiry, shuffled questions, no answer key in the response.
- Complaints: create with attachment, status workflow, required response on close, one follow-up comment, signed-URL attachments.
- Gradebook CSV with UTF-8 BOM and formula-injection escaping.
- Responsive CSS breakpoints from 1200 px down to 370 px.

## 2. Partially implemented

| ID | Priority | Issue |
|----|----------|-------|
| P1 | High | Courses are created as `draft` and there is no UI to publish them. RLS only shows `published` courses to students, so **enrolled students never see any course**. |
| P2 | High | Lessons: API exists, but there's no UI to add or view lessons. `lesson_progress` and `enrollments.progress` are never used, so course progress is always 0%. |
| P3 | High | Assignment submission is a `window.prompt` text box. There's no file upload (the spec requires text and/or a file), and teachers grading in the Gradebook **can't see what the student submitted**. |
| P4 | High | Notifications are written on complaint status changes, but there's no API or UI to read them. The bell shows a permanent fake red dot. |
| P5 | Medium | Quiz builder supports exactly one question with two options. No multi-select or true/false, and teachers can't see per-student results (the endpoint exists but nothing uses it). |
| P6 | Medium | Announcements always show "Northstar team" / "Community" instead of the author and course. No delete in the UI. Teachers are offered "Everyone", which RLS rejects. |
| P7 | Medium | Unenroll and role-change endpoints have no UI. Enrollment always reports `duplicates: []`. |
| P8 | Medium | Resource delete exists in the API but not in the UI. |
| P9 | Medium | "My marks" omits assignments the student hasn't submitted, because the `student_marks` view joins from assignments, not enrollments. |

## 3. Missing

| ID | Priority | Issue |
|----|----------|-------|
| M1 | High | No automated tests (the spec requires Vitest + Supertest) and no lint configuration. |
| M2 | Medium | No `submissions` storage bucket (needed for file submissions). |
| M3 | Medium | No 404 page or error boundary. Any render error blanks the whole app. |
| M4 | Low | No show/hide password toggle on the login form (spec). |

## 4. Broken

| ID | Priority | Issue |
|----|----------|-------|
| B1 | Critical | `QuizzesPage` reads an undeclared `session` variable, so opening **Quizzes throws a ReferenceError and blanks the app**. It also contains a copy-pasted chat realtime subscription. |
| B2 | High | Resource routes are mounted at `/api/:resourceId/download` and `DELETE /api/:resourceId` instead of `/api/resources/...`. That's a catch-all single-segment route. |
| B3 | High | Every Supabase error becomes HTTP 500 "The request could not be completed": RLS denials (should be 403), missing rows (404), malformed UUIDs (400), duplicates (409), and oversized uploads (413). |
| B4 | High | `unique(course_id, position)` and `unique(module_id, position)` with a default position of 0 mean the second lesson in a module always fails. Module position is computed client-side. |
| B5 | High | Fabricated data shown as real: dashboard metrics ("12.4 h", "top 18%", "86% engagement"), activity chart, learning streak, nav badges (3/2/4), "Northstar, Inc." workspace, "Member since April 2025", hardcoded date "MONDAY, OCTOBER 26, 2026", a schedule fixed to one week with events placed by array index, and a fake "learning circle". |
| B6 | High | Demo mode: when Supabase env vars are missing, the app runs as a fake **admin** with sample data (`canAdmin = !session || …`). The profile is cached in `localStorage`. |
| B7 | Medium | Course page shows the *viewer's* name as the instructor. Course cards show "Course instructor" and 0 lessons for every course. |
| B8 | Medium | No-op controls: Filter, Calendar view, workspace switcher, "Last 7 days", ⌘K hint, the "…" option buttons, and the schedule week arrows. Learning filters are hardcoded categories. |
| B9 | Low | Gradebook row separator renders as "?" (mojibake). |

## 5. Security

| ID | Priority | Issue |
|----|----------|-------|
| S1 | Critical | **Hosted Supabase Auth has public signup enabled.** Anyone can call `signUp` with the public anon key, and `handle_new_user` creates an **active student** profile that can sign in. (Manual dashboard fix, plus a code hardening below.) |
| S2 | Critical | `New Text Document.txt` in the project root holds the database password in plaintext and isn't gitignored. Delete it and rotate the database password. |
| S3 | Medium | An admin can demote their own account (possibly the last admin) with no guard. |
| S4 | Low | Resource list for a non-member returns an empty list instead of 403 (data is still protected by RLS). |
| S5 | Low | Realtime auth token isn't refreshed after the access token rotates (chat goes quiet after about an hour). |

## 6. Database / Supabase

- Schema matches the migration. `schema.sql` is an intentional duplicate of the migration for SQL Editor use.
- No admin exists yet. The README promotion step must also set `is_active = true` once signup hardening lands.
- Spec deviation kept as-is: the column is `complainant_id`, not `raised_by`; `status` uses text with a check instead of an enum; there are extra `notifications` and `lesson_progress` tables.
- Additive migration needed: private `submissions` bucket; `handle_new_user` creates **inactive** profiles (only admin-created accounts become active); `student_marks` rebuilt from enrollments so pending items appear.

## 7. Recommendations not taken (would be a rebuild)

The spec asks for TypeScript, Tailwind/shadcn, TanStack Query, a `{data, meta}` envelope, and a controller/service/repository layering. The existing JavaScript stack works and the brief says not to rebuild, so these stay as documented deviations.

## Implementation plan

1. Backend: shared course-access helpers; Supabase error → HTTP mapping; resource route fix; server-side positions; lesson CRUD and completion; course list with teachers/counts/progress; announcement author/course data and teacher rules; submission file upload and download; notifications API; enrollment duplicates; self-demotion guard; quiz builder cleanup and student attempt status; remove the duplicate single-enroll route.
2. Migration `20261027000000_hardening.sql` (additive only).
3. Frontend: remove demo mode and fabricated data; error boundary and 404; real dashboard, badges, and schedule; submission modal with file; lesson authoring, viewer, and progress; course publish/archive; resource delete; unenroll; role change; announcement authorship and delete; notifications menu; full quiz builder and teacher results; grading view with student answers; password visibility toggle.
4. ESLint for both packages; Vitest + Supertest API tests with a mocked Supabase client.
5. Build, lint, test, and run both servers; exercise the UI in a browser.
6. Rebrand.
