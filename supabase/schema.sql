-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query) for a new project.
-- Identity, role, and department live here in Supabase; call/transcript/coaching data stays in the
-- existing SQLite backend (server/data/coaching.db) and is joined to a person by email.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  -- System-level access. "Application Admin" vs "Employee" in the product's own wording.
  role text not null default 'employee' check (role in ('admin', 'employee')),
  -- Org position, independent of role. "Department Manager" vs "Staff".
  position text not null default 'staff' check (position in ('manager', 'staff')),
  -- Free text for now — normalize into a lookup table later if departments need their own metadata.
  department text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Signed-in users can read their own profile (the app needs this to know its own role/position).
-- All other reads (e.g. a manager's department roster) go through the server's service-role key,
-- which bypasses RLS by design — there is no policy granting cross-profile reads to end users.
create policy "read own profile" on public.profiles
  for select
  using (auth.uid() = id);

-- No update/insert/delete policy for regular users: role, position, and department are admin-managed
-- (Table Editor, or a server-side route using the service-role key) during this prep phase, not
-- self-service — a self-update policy for role/position would need care to avoid self-promotion.

-- Auto-create a blank profile (role=employee, position=staff, no department) whenever someone is
-- added in Supabase Auth, so there's always a row to edit. An admin promotes people afterwards —
-- for now, directly in the Table Editor (Project -> Table Editor -> profiles).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
