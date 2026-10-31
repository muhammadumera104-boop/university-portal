# Deploying GU TECH to Vercel

One Vercel project serves both the web app and the API from the same address:

- `https://YOUR-SITE.vercel.app/` is the React app (built from `Front end/`).
- `https://YOUR-SITE.vercel.app/api/...` is the Express API (`api/index.js` runs `Back end/src/app.js`).

Because both share one origin, sign-in cookies work in every browser and no CORS setup is needed. The routing and security headers live in the root `vercel.json`.

## Before you deploy

1. Both Supabase migrations in `Back end/supabase/migrations/` are applied (the database already has them).
2. Public sign-up is disabled in Supabase Auth.
3. You have an admin account.
4. **Your database password was in `New Text Document.txt`, which was committed to Git.** The password has been changed, so the old one is useless, but remove the file from the repository history if the GitHub repository is, or ever becomes, public.
5. Nothing secret is committed: `.env` files are ignored by `.gitignore`. Check with `git status` before you push.

## Deploy

1. Push the project to GitHub. Do not commit `.env` files.
2. In Vercel choose **Add New → Project** and import the repository.
3. Leave **Root Directory** empty (the repository root). Vercel reads `vercel.json`, so keep the detected install, build and output settings. If it asks for a Framework Preset, choose **Other**.
4. Add these **Environment Variables** (Production and Preview):

   | Name | Value | Notes |
   | --- | --- | --- |
   | `SUPABASE_URL` | your project URL | Settings → API |
   | `SUPABASE_ANON_KEY` | the public (anon/publishable) key | Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service-role (secret) key | **Server only.** Never prefix it with `VITE_`. |
   | `FRONTEND_ORIGIN` | `https://YOUR-SITE.vercel.app` | no trailing slash |
   | `PASSWORD_RESET_REDIRECT` | `https://YOUR-SITE.vercel.app/reset-password` | |
   | `MAX_UPLOAD_MB` | `4` | Vercel rejects request bodies over about 4.5 MB |
   | `VITE_SUPABASE_URL` | your project URL | public |
   | `VITE_SUPABASE_ANON_KEY` | the public key | public |
   | `VITE_API_URL` | `/api` | relative, because the site and API share a domain |
   | `VITE_MAX_UPLOAD_MB` | `4` | must match `MAX_UPLOAD_MB` |

   Name the Vercel project so its address matches `YOUR-SITE` above. If Vercel gives a different address, update `FRONTEND_ORIGIN` and `PASSWORD_RESET_REDIRECT`, then redeploy.
5. Click **Deploy**.

## After the first deploy

1. In Supabase go to **Authentication → URL Configuration**. Set **Site URL** to `https://YOUR-SITE.vercel.app` and add `https://YOUR-SITE.vercel.app/reset-password` to **Redirect URLs**. Without this, password-reset emails link to the wrong place.
2. Open `https://YOUR-SITE.vercel.app/api/health`. It should show `{"status":"ok","supabaseConfigured":true}`.
3. Open the site and sign in as admin. Then check, in order: registering a test student at `/register`, approving it in Administration, creating a course, and opening it.

## Limits to know about

- **File uploads are capped at about 4 MB** on Vercel (resources, assignment files and complaint attachments). Files up to 25 MB need a host that runs the API as a normal server, such as Render or Railway: run `npm install` and `npm start` in `Back end/`, set `VITE_API_URL` to that server's `/api` address, and set `FRONTEND_ORIGIN` to the site address.
- **Rate limits are per function instance.** Vercel can run several at once, so the sign-in lockout (5 tries per 15 minutes) is weaker than on a single server. Supabase Auth applies its own limits as well.
- **Bulk account import** can take up to a minute for 100 rows, which is the configured function limit.
- Vercel's free Hobby plan is for non-commercial use.

## Run it locally exactly as deployed

`npm run dev` in `Back end/` and in `Front end/` is still the normal local setup. Nothing about deployment changes it.
