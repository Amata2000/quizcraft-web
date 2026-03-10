-- ============================================================
-- QuizCraft Database Schema
-- Run this entire file in: Supabase → SQL Editor → New Query
-- ============================================================

-- ── Admin table (single row) ──────────────────────────────
create table if not exists admin (
  id          text primary key default 'admin',
  username    text not null unique,
  password_hash text not null,
  role        text not null default 'admin',
  created_at  timestamptz not null default now()
);

-- ── Teachers table ────────────────────────────────────────
create table if not exists teachers (
  id            text primary key,
  name          text not null,
  username      text not null unique,
  password_hash text not null,
  role          text not null default 'teacher',
  created_at    timestamptz not null default now()
);

-- ── Quizzes table ─────────────────────────────────────────
-- "questions" is stored as JSONB (the full array of question objects)
-- "settings"  is stored as JSONB (timeLimit, shuffleQ, etc.)
create table if not exists quizzes (
  id              text primary key,
  code            text not null unique,
  title           text not null,
  subject         text,
  description     text,
  time_limit      integer not null default 0,
  available_from  timestamptz,
  available_to    timestamptz,
  shuffle_q       boolean not null default false,
  shuffle_opts    boolean not null default false,
  max_attempts    integer not null default 0,
  show_results    boolean not null default true,
  password        text,
  active          boolean not null default true,
  questions       jsonb not null default '[]',
  created_by      text,
  created_by_role text,
  created_by_name text,
  created_at      timestamptz not null default now()
);

-- ── Submissions table ─────────────────────────────────────
create table if not exists submissions (
  id            text primary key,
  quiz_id       text not null references quizzes(id) on delete cascade,
  student_name  text not null,
  student_email text,
  answers       jsonb not null default '{}',
  score         jsonb not null default '{}',
  submitted_at  timestamptz not null default now()
);

-- ── Quiz attempt autosave table ───────────────────────────
create table if not exists quiz_attempts (
  quiz_id        text not null,
  student_name   text not null,
  student_email  text,
  answers        jsonb not null default '{}',
  question_order jsonb not null default '[]',
  saved_at       timestamptz not null default now(),
  primary key (quiz_id, student_name)
);

-- ── Indexes for common queries ────────────────────────────
create index if not exists idx_submissions_quiz_id on submissions(quiz_id);
create index if not exists idx_quizzes_code on quizzes(code);

-- ── Row Level Security ────────────────────────────────────
-- QuizCraft uses its own username/password auth (not Supabase Auth),
-- so we allow full access via the anon key for simplicity.
-- For a production app with real users you would tighten these policies.

alter table admin        enable row level security;
alter table teachers     enable row level security;
alter table quizzes      enable row level security;
alter table submissions  enable row level security;
alter table quiz_attempts enable row level security;

-- Allow all operations from the browser (anon key)
create policy "allow_all_admin"         on admin         for all using (true) with check (true);
create policy "allow_all_teachers"      on teachers      for all using (true) with check (true);
create policy "allow_all_quizzes"       on quizzes       for all using (true) with check (true);
create policy "allow_all_submissions"   on submissions   for all using (true) with check (true);
create policy "allow_all_quiz_attempts" on quiz_attempts for all using (true) with check (true);
