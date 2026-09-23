-- Run this in the Supabase SQL Editor after 002_calls.sql.
--
-- Answers one question the UI could not previously ask: "which days actually have calls worth
-- coaching?" Coaching is on-demand and per-day, so a date picker that shows every day alike
-- makes people hunt blindly through empty Saturdays and days off.
--
-- Querying RingCentral for a whole month at render time is not an option: ~110 recorded calls a
-- day is ~3,300 records a month, which at perPage 250 is ~14 call-log requests against a budget
-- of 10 per 60s (see server/src/ringcentral.ts). The rate pacer would stall past any function
-- timeout. So counts are cached here instead, and the calendar reads only Postgres.
--
-- This table holds COUNTS ONLY. No audio, no transcripts, no customer content — so it is not
-- subject to the retention concerns that govern public.calls, and it can be rebuilt at any time
-- from the RingCentral call log.

create table if not exists public.call_day_index (
  day date not null,                          -- calendar day in Asia/Manila, the app's timezone
  extension_id text not null,                 -- RingCentral extension id of the agent on the call
  agent_email text not null,                  -- denormalised from the extension, so the month
                                              -- query needs no RingCentral round trip to scope
                                              -- results to the viewer
  coachable_count integer not null default 0, -- calls passing isCoachable() (recorded, >= 90s)
  indexed_at timestamptz not null default now(),
  primary key (day, extension_id)
);

-- Deliberately NOT a foreign key to public.agents: that table only gains a row when someone is
-- actually coached, whereas the index covers every extension that appears in the call log.
-- Requiring the FK would silently drop exactly the un-coached days this table exists to reveal.

create index if not exists call_day_index_day_idx on public.call_day_index (day);
create index if not exists call_day_index_email_day_idx on public.call_day_index (agent_email, day);

-- Same posture as every other table here: deny by default, all access through the service-role
-- key with RBAC applied in server/src/auth.ts. The browser never queries this directly.
alter table public.call_day_index enable row level security;
