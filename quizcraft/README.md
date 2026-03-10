# QuizCraft — Deployment Guide

## Step 1: Run the database schema in Supabase

1. Go to https://supabase.com → your project → **SQL Editor**
2. Click **New Query**
3. Open the file `supabase-schema.sql` from this folder
4. Paste the entire contents into the editor
5. Click **Run**

You should see 5 tables created: `admin`, `teachers`, `quizzes`, `submissions`, `quiz_attempts`

---

## Step 2: Install dependencies and run locally

Make sure you have Node.js 18+ installed. Then:

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

Open http://localhost:3000 in your browser. You should see QuizCraft running.

The first time you click "Staff Login", it will ask you to create an admin account — that's normal.

---

## Step 3: Push to GitHub

```bash
# Initialise git (if you haven't already)
git init
git add .
git commit -m "Initial QuizCraft commit"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/quizcraft.git
git branch -M main
git push -u origin main
```

⚠️  The `.gitignore` already excludes `.env.local` — your keys will NOT be pushed to GitHub.

---

## Step 4: Deploy on Vercel

1. Go to https://vercel.com/new
2. Click **Import Git Repository** → select your `quizcraft` repo
3. Vercel will auto-detect Next.js — no changes needed
4. Before clicking Deploy, click **Environment Variables** and add:

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xghqqsbromhhagaftzdm.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (your full key) |

5. Click **Deploy**

Your app will be live at `https://quizcraft-xxxx.vercel.app` within ~1 minute.

---

## Ongoing: Redeployments

Every time you push to the `main` branch on GitHub, Vercel automatically redeploys. No manual steps needed.

---

## Security note

After you've confirmed everything is working, it's good practice to go to:
**Supabase → Settings → API → Regenerate anon key**

Then update the environment variable in Vercel with the new key.
This ensures the key shared during setup is no longer active.
