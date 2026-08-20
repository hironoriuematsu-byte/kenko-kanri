-- ============================================================
-- 0122_hm_office_info.sql : 産業医事務所の情報(帳票・CSV出力用)
-- ============================================================
-- 定期健康診断結果報告書などに記載する産業医名・事務所名・所在地を保持する。
-- 1行のみ運用(id = 'default')。編集はofficeのみ、閲覧は認証ユーザー。
-- ============================================================

create table if not exists public.hm_office_info (
  id text primary key default 'default',
  office_name text not null default 'うえまつ産業医事務所',
  address text,
  tel text,
  physician_name text not null default '上松弘典',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.hm_office_info enable row level security;

drop policy if exists hm_office_info_select on public.hm_office_info;
drop policy if exists hm_office_info_insert on public.hm_office_info;
drop policy if exists hm_office_info_update on public.hm_office_info;

create policy hm_office_info_select on public.hm_office_info
  for select using (auth.uid() is not null);
create policy hm_office_info_insert on public.hm_office_info
  for insert with check (public.hm_is_office());
create policy hm_office_info_update on public.hm_office_info
  for update using (public.hm_is_office()) with check (public.hm_is_office());

revoke delete on public.hm_office_info from anon, authenticated;

drop trigger if exists hm_office_info_set_updated_at on public.hm_office_info;
create trigger hm_office_info_set_updated_at
  before update on public.hm_office_info
  for each row execute function public.hm_set_updated_at();

insert into public.hm_office_info (id, office_name, physician_name)
values ('default', 'うえまつ産業医事務所', '上松弘典')
on conflict (id) do nothing;
