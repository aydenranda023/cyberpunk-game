-- 1. Create Profiles table (User data)
create table if not exists profiles (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);

-- 2. Create Rooms table (Game sessions)
create table if not exists rooms (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);

-- 3. Enable Realtime for Rooms (Check if already added)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rooms') then
    alter publication supabase_realtime add table rooms;
  end if;
end $$;

-- 4. Set generic Row Level Security (RLS) policies 
alter table rooms enable row level security;
-- Drop policy if exists to allow re-running
drop policy if exists "Allow all access" on rooms;
create policy "Allow all access" on rooms for all using (true) with check (true);

alter table profiles enable row level security;
drop policy if exists "Allow all access" on profiles;
create policy "Allow all access" on profiles for all using (true) with check (true);
