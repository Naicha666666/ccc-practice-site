create table if not exists public.user_question_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  year integer not null,
  question_number integer not null,
  last_answer text check (last_answer is null or last_answer in ('A', 'B', 'C', 'D', 'E')),
  correct boolean,
  wrong boolean not null default false,
  favorite boolean not null default false,
  revealed boolean not null default false,
  answered_at timestamptz,
  last_visited_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.user_question_progress enable row level security;

drop policy if exists "Users can read own progress" on public.user_question_progress;
create policy "Users can read own progress"
on public.user_question_progress
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own progress" on public.user_question_progress;
create policy "Users can insert own progress"
on public.user_question_progress
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own progress" on public.user_question_progress;
create policy "Users can update own progress"
on public.user_question_progress
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own progress" on public.user_question_progress;
create policy "Users can delete own progress"
on public.user_question_progress
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists user_question_progress_user_updated_idx
on public.user_question_progress (user_id, updated_at desc);
