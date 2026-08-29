-- =============================================
-- PrintHub — Supabase Database Setup
-- Run this in: Supabase Dashboard → SQL Editor
-- =============================================

-- ============================================
-- STEP 1: Profiles table
-- ============================================
create table if not exists public.profiles (
  id         uuid references auth.users on delete cascade primary key,
  name       text not null default '',
  student_id text default '',
  phone      text default '',
  role       text not null default 'customer',  -- 'customer' or 'owner'
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Policies
create policy "Users: read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users: update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users: insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Owner: read all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

-- ============================================
-- STEP 2: Jobs table
-- ============================================
create table if not exists public.jobs (
  id                   uuid default gen_random_uuid() primary key,
  customer_id          uuid references public.profiles(id) on delete cascade,
  customer_name        text default '',
  customer_student_id  text default '',
  file_name            text default '',
  file_path            text default '',
  file_size            bigint default 0,
  color_mode           text default 'monochrome',  -- 'monochrome' | 'color'
  paper_size           text default 'A4',
  sides                text default 'single',       -- 'single' | 'double'
  copies               int default 1,
  pickup_time          text default 'As soon as ready',
  instructions         text default '',
  status               text default 'pending',      -- 'pending' | 'printing' | 'ready' | 'completed' | 'cancelled'
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

alter table public.jobs enable row level security;

-- Policies (Public access for no-login ordering + Owner management)
create policy "Public: insert jobs"
  on public.jobs for insert
  with check (true);

create policy "Public: read jobs"
  on public.jobs for select
  using (true);

create policy "Public: update jobs"
  on public.jobs for update
  using (true);

create policy "Owner: delete all jobs"
  on public.jobs for delete
  using (true);

-- ============================================
-- STEP 3: Auto-create profile on user signup
-- ============================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, student_id, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'student_id', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    case
      when new.email = 'rozaliismail1976@gmail.com' then 'owner'
      else 'customer'
    end
  );
  return new;
end;
$$ language plpgsql security definer;

-- Attach trigger
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================
-- STEP 4: Storage bucket + policies
-- ============================================
-- Create the bucket (run separately if it errors here)
insert into storage.buckets (id, name, public)
values ('print-files', 'print-files', false)
on conflict (id) do nothing;

-- Storage policies (Public access for uploads & owner access)
create policy "Public: upload print files"
  on storage.objects for insert
  with check (bucket_id = 'print-files');

create policy "Public: read print files"
  on storage.objects for select
  using (bucket_id = 'print-files');

create policy "Public: delete print files"
  on storage.objects for delete
  using (bucket_id = 'print-files');

-- ============================================
-- DONE! ✓
-- Now go to: Authentication → Settings
-- Set "Confirm email" = OFF (for easy testing)
-- ============================================
