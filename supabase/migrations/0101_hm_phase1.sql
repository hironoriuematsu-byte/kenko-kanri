-- ============================================================
-- 0101_hm_phase1.sql : 健康管理Web Phase 1
--   基盤(権限ヘルパー・監査ログ) + 安全衛生委員会 議事録管理
-- ============================================================
-- 方針(要件定義書 第5章):
--   * 追加のみ。既存テーブル・既存ポリシー・既存関数は一切変更しない
--   * 新規オブジェクトはすべて hm_ 接頭辞
--   * 危険・横断的操作は SECURITY DEFINER RPC + 関数内権限チェック + ログ記録
-- 開発用プロジェクトでは 0000_dev_base.sql を先に実行しておくこと。
-- 本番プロジェクトではこのファイルから実行する(0000は実行しない)。
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. 権限ヘルパー関数(既存 profiles を参照するのみ)
-- ------------------------------------------------------------

create or replace function public.hm_my_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.hm_my_company()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.hm_is_office()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'office'
  )
$$;

-- ------------------------------------------------------------
-- 2. 監査ログ(hm_access_logs) — 削除・変更不可
-- ------------------------------------------------------------

create table if not exists public.hm_access_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,             -- view / create / update / delete / export など
  target_table text not null,
  target_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.hm_access_logs enable row level security;

-- 閲覧はofficeのみ。insert/update/deleteのポリシーは作らない
-- (書き込みは下のSECURITY DEFINER関数経由のみ)
create policy hm_access_logs_select_office on public.hm_access_logs
  for select using (public.hm_is_office());

revoke insert, update, delete on public.hm_access_logs from anon, authenticated;

create or replace function public.hm_log_access(
  p_action text,
  p_target_table text,
  p_target_id uuid default null,
  p_detail jsonb default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.hm_access_logs (user_id, action, target_table, target_id, detail)
  values (auth.uid(), p_action, p_target_table, p_target_id, p_detail);
end;
$$;

-- ------------------------------------------------------------
-- 3. 安全衛生委員会 議事録(hm_minutes)
-- ------------------------------------------------------------

create table if not exists public.hm_minutes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  meeting_date date not null,
  title text not null default '安全衛生委員会',
  attendees text,                          -- 出席者(自由記載)
  physician_attended boolean not null default false,  -- 産業医出席の有無
  agenda text,                             -- 審議事項
  decisions text,                          -- 決定事項
  next_meeting_date date,                  -- 次回予定
  next_meeting_note text,
  published_to_employees boolean not null default false, -- 従業員公開
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                   -- 論理削除(officeのRPCのみ)
);

create index if not exists hm_minutes_company_date_idx
  on public.hm_minutes (company_id, meeting_date desc);

alter table public.hm_minutes enable row level security;

-- 閲覧: office=全社 / company=自社 / employee=自社の公開分のみ
create policy hm_minutes_select on public.hm_minutes
  for select using (
    deleted_at is null
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
      or (public.hm_my_role() = 'employee'
          and company_id = public.hm_my_company()
          and published_to_employees)
    )
  );

-- 作成: office(任意の企業) / company(自社のみ)
create policy hm_minutes_insert on public.hm_minutes
  for insert with check (
    created_by = auth.uid()
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  );

-- 編集: office / company(自社)。論理削除済みは不可
create policy hm_minutes_update on public.hm_minutes
  for update using (
    deleted_at is null
    and (
      public.hm_is_office()
      or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
    )
  )
  with check (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and company_id = public.hm_my_company())
  );

-- 物理削除は誰にも許可しない(deleteポリシーなし)
revoke delete on public.hm_minutes from anon, authenticated;

-- 議事録の削除(論理削除)はofficeのみ・RPC経由・ログ必須
create or replace function public.hm_delete_minutes(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_minutes
     set deleted_at = now(), updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then
    raise exception 'minutes not found or already deleted';
  end if;
  perform public.hm_log_access(
    'delete', 'hm_minutes', p_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

-- updated_at 自動更新
create or replace function public.hm_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists hm_minutes_set_updated_at on public.hm_minutes;
create trigger hm_minutes_set_updated_at
  before update on public.hm_minutes
  for each row execute function public.hm_set_updated_at();

-- ------------------------------------------------------------
-- 4. 議事録の添付ファイル(hm_minute_files) + Storageバケット
-- ------------------------------------------------------------

create table if not exists public.hm_minute_files (
  id uuid primary key default gen_random_uuid(),
  minutes_id uuid not null references public.hm_minutes(id),
  file_name text not null,
  storage_path text not null,        -- hm-files バケット内: {company_id}/{minutes_id}/{filename}
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.hm_minute_files enable row level security;

-- 添付の閲覧・追加は親議事録の権限に従う(公開議事録の従業員閲覧を含む)
create policy hm_minute_files_select on public.hm_minute_files
  for select using (
    exists (select 1 from public.hm_minutes m where m.id = minutes_id)
  );

create policy hm_minute_files_insert on public.hm_minute_files
  for insert with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.hm_minutes m
      where m.id = minutes_id
        and (
          public.hm_is_office()
          or (public.hm_my_role() = 'company' and m.company_id = public.hm_my_company())
        )
    )
  );

create policy hm_minute_files_delete on public.hm_minute_files
  for delete using (
    public.hm_is_office()
    or (
      public.hm_my_role() = 'company'
      and exists (
        select 1 from public.hm_minutes m
        where m.id = minutes_id and m.company_id = public.hm_my_company()
      )
    )
  );

-- Storage バケット hm-files(非公開)
insert into storage.buckets (id, name, public)
values ('hm-files', 'hm-files', false)
on conflict (id) do nothing;

-- パスの第1階層 = company_id で企業別にアクセス制御
create policy hm_files_select on storage.objects
  for select using (
    bucket_id = 'hm-files'
    and (
      public.hm_is_office()
      or (storage.foldername(name))[1] = public.hm_my_company()::text
    )
  );

create policy hm_files_insert on storage.objects
  for insert with check (
    bucket_id = 'hm-files'
    and (
      public.hm_is_office()
      or (
        public.hm_my_role() = 'company'
        and (storage.foldername(name))[1] = public.hm_my_company()::text
      )
    )
  );

create policy hm_files_delete on storage.objects
  for delete using (
    bucket_id = 'hm-files'
    and (
      public.hm_is_office()
      or (
        public.hm_my_role() = 'company'
        and (storage.foldername(name))[1] = public.hm_my_company()::text
      )
    )
  );
