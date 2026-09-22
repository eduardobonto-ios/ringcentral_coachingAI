-- Run this in the Supabase SQL Editor after schema.sql.
--
-- Moves call/transcript/coaching data out of server/data/coaching.db and into Postgres, so the
-- app can be hosted (Vercel now, Azure later) instead of depending on one machine's filesystem.
-- Audio lives in the private "call-recordings" storage bucket, not on disk.
--
-- Column names deliberately mirror the SQLite schema in server/src/db.ts so the port is
-- mechanical and the existing API response shapes do not change.

-- 1. profiles drift fix ---------------------------------------------------------------------
-- The live table was created without these two, but server/src/auth.ts selects them, so every
-- sign-in currently fails with "No profile is set up for this account yet".
alter table public.profiles
  add column if not exists position text not null default 'staff'
    check (position in ('manager', 'staff')),
  add column if not exists department text;

-- The live table also has must_change_password, which schema.sql never declared. Recorded here
-- so the file matches reality.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- 2. agents ---------------------------------------------------------------------------------
-- One row per coachable person. `id` is the RingCentral extension id, which is how the call log
-- identifies who was on a call; email is how coaching reaches them.
create table if not exists public.agents (
  id text primary key,
  name text not null,
  email text not null,
  role text not null,
  created_at timestamptz not null default now()
);

create index if not exists agents_email_idx on public.agents (email);

-- 3. calls ----------------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key,
  recorded_at timestamptz not null,
  duration_sec integer not null,
  status text not null,                 -- uploaded | transcribed | needs-analysis | analyzed
  source text not null,                 -- manual-upload | ringcentral
  direction text not null,              -- inbound | outbound | unknown
  agent_id text not null references public.agents(id),
  audio_path text not null,             -- object key within the call-recordings bucket
  engine text,
  transcript_json jsonb,
  analysis_json jsonb,
  external_id text,                     -- rc:<recordingId>; null for manual uploads
  created_at timestamptz not null default now()
);

-- Partial unique index: every manual upload has a null external_id and must not collide.
create unique index if not exists calls_external_id_key
  on public.calls (external_id) where external_id is not null;

create index if not exists calls_agent_recorded_idx on public.calls (agent_id, recorded_at desc);
create index if not exists calls_recorded_at_idx on public.calls (recorded_at desc);

-- 4. emails ---------------------------------------------------------------------------------
create table if not exists public.emails (
  call_id uuid primary key references public.calls(id) on delete cascade,
  status text not null,                 -- sent | dry-run | failed
  to_email text not null,
  subject text not null,
  body_html text not null,
  sent_at timestamptz,
  error text
);

-- 5. row level security ---------------------------------------------------------------------
-- Deny by default. Every read the app performs goes through the server's service-role key,
-- which bypasses RLS and applies its own RBAC in server/src/auth.ts (an employee sees only
-- their own calls, a manager only their department). No policies are granted to end users:
-- the browser never queries these tables directly, and coaching data is need-to-know.
alter table public.agents enable row level security;
alter table public.calls  enable row level security;
alter table public.emails enable row level security;
