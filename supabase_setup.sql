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

-- 3. Enable Realtime for Rooms (Specific columns or all)
alter publication supabase_realtime add table rooms;

-- 4. Set generic Row Level Security (RLS) policies 
-- (For development speed, we allow public access. Secure this later!)
alter table rooms enable row level security;
create policy "Allow all access" on rooms for all using (true) with check (true);

alter table profiles enable row level security;
create policy "Allow all access" on profiles for all using (true) with check (true);
