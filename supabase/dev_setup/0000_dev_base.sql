-- ============================================================
-- 0000_dev_base.sql : 開発用Supabaseプロジェクト専用
-- ============================================================
-- ※※※ 本番(ストレスチェックWebと共用のプロジェクト)では絶対に実行しない ※※※
-- 本番には companies / profiles が既に存在するため、このファイルは
-- 「無料の開発用プロジェクト」に既存スキーマの最小限の代替を作るためだけのものです。
-- ============================================================

create extension if not exists pgcrypto;

-- 企業(既存テーブルの最小限の再現)
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ユーザー属性(既存テーブルの最小限の再現)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'employee'
    check (role in ('office', 'jimu', 'employee', 'company')),
  full_name text,
  employee_no text,
  department text,
  company_id uuid references public.companies(id),
  created_at timestamptz not null default now()
);

alter table public.companies enable row level security;
alter table public.profiles enable row level security;

-- 判定用ヘルパー(SECURITY DEFINERでRLSをバイパスして判定する。
--  profilesのポリシー内でprofiles自身をselectすると無限再帰になるため)
create or replace function public.dev_is_office()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'office'
  )
$$;

create or replace function public.dev_my_company()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.dev_my_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- 自分のプロフィールは読める
create policy dev_profiles_select_own on public.profiles
  for select using (id = auth.uid());

-- office は全プロフィールを読める / company は自社のみ
create policy dev_profiles_select_office on public.profiles
  for select using (public.dev_is_office());
create policy dev_profiles_select_company on public.profiles
  for select using (
    public.dev_my_role() = 'company'
    and company_id is not null
    and company_id = public.dev_my_company()
  );

-- companies: office は全社 / それ以外は自社のみ
create policy dev_companies_select on public.companies
  for select using (
    public.dev_is_office() or id = public.dev_my_company()
  );
create policy dev_companies_insert_office on public.companies
  for insert with check (public.dev_is_office());

-- サインアップ時にprofilesを自動作成(開発用)
create or replace function public.dev_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists dev_on_auth_user_created on auth.users;
create trigger dev_on_auth_user_created
  after insert on auth.users
  for each row execute function public.dev_handle_new_user();

-- ============================================================
-- 動作確認用データの作り方(SQL Editorで実行):
--
-- 1) Supabaseダッシュボード Authentication > Users > Add user で
--    自分用のユーザーを作成(メール+パスワード、Auto Confirm ON)
--
-- 2) テスト企業を作成:
--    insert into companies (name) values ('テスト株式会社');
--
-- 3) 自分をoffice(産業医事務所)にする:
--    update profiles set role = 'office', full_name = '上松 先生'
--    where id = (select id from auth.users where email = '自分のメールアドレス');
--
-- 4) company(企業側担当者)のテストユーザーも同様に作成して:
--    update profiles set role = 'company',
--      company_id = (select id from companies where name = 'テスト株式会社')
--    where id = (select id from auth.users where email = '担当者のメールアドレス');
-- ============================================================
