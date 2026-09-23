-- Run this in the Supabase SQL Editor after 003_call_day_index.sql.
--
-- Day-level coaching, stored rather than recomputed.
--
-- Until now the "daily" view was a tally: src/dailyRollup.ts counted the most frequent strength
-- and improvement titles across whatever calls an agent happened to coach, in the browser. With
-- one coached call out of a day's twenty-two, "most common" is just that one call wearing a
-- daily label — and the panel reported "1 of 3" because it counted rows in public.calls rather
-- than the day's real volume.
--
-- A day summary is one model call over the day's analyses, so it is worth keeping rather than
-- regenerating every time someone opens the page. It is regenerated when more of the day gets
-- coached, which is why calls_reviewed is stored alongside it: a summary drawn from three calls
-- and one drawn from eight are not the same claim, and the UI says which it is showing.

create table if not exists public.daily_coaching (
  day date not null,
  agent_email text not null,
  summary_json jsonb not null,       -- headline, pattern, keepDoing, focusOn, practiceAction
  calls_reviewed integer not null,   -- analysed calls the summary was actually drawn from
  calls_total integer not null,      -- coachable calls that day, from public.call_day_index
  generated_at timestamptz not null default now(),
  primary key (day, agent_email)
);

create index if not exists daily_coaching_email_day_idx on public.daily_coaching (agent_email, day desc);

-- Same posture as the rest: deny by default, all access through the service-role key with RBAC
-- applied in server/src/auth.ts. The browser never queries this directly.
alter table public.daily_coaching enable row level security;
