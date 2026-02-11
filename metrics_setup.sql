-- 1. Create a table to track daily API usage
create table if not exists system_stats (
  date_key text primary key, -- Format: 'YYYY-MM-DD'
  request_count int default 0,
  updated_at timestamptz default now()
);

-- 2. Enable RLS (Service Role only should write to this)
alter table system_stats enable row level security;
create policy "Allow read access" on system_stats for select using (true);

-- 3. Create a function to atomically increment usage
create or replace function increment_daily_usage(date_str text)
returns int
language plpgsql
as $$
declare
  current_val int;
begin
  insert into system_stats (date_key, request_count)
  values (date_str, 1)
  on conflict (date_key)
  do update set request_count = system_stats.request_count + 1
  returning request_count into current_val;
  
  return current_val;
end;
$$;
