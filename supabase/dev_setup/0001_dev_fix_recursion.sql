-- ============================================================
-- 0001_dev_fix_recursion.sql : 開発用プロジェクト専用の修正パッチ
-- ============================================================
-- ※※※ 本番(ストレスチェックWebと共用のプロジェクト)では絶対に実行しない ※※※
-- 0000_dev_base.sql のRLSポリシーが profiles を自己参照しており
-- 「infinite recursion detected」でプロフィールが読めなくなる不具合の修正。
-- SECURITY DEFINER関数(RLSを介さず判定)に置き換える。
-- ============================================================

-- 判定用ヘルパー(RLSをバイパスして安全に判定)
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

-- 再帰していた旧ポリシーを削除
drop policy if exists dev_profiles_select_office on public.profiles;
drop policy if exists dev_profiles_select_company on public.profiles;
drop policy if exists dev_companies_select on public.companies;
drop policy if exists dev_companies_insert_office on public.companies;

-- ヘルパー関数を使って作り直し(再帰しない)
create policy dev_profiles_select_office on public.profiles
  for select using (public.dev_is_office());

create policy dev_profiles_select_company on public.profiles
  for select using (
    public.dev_my_role() = 'company'
    and company_id is not null
    and company_id = public.dev_my_company()
  );

create policy dev_companies_select on public.companies
  for select using (
    public.dev_is_office() or id = public.dev_my_company()
  );

create policy dev_companies_insert_office on public.companies
  for insert with check (public.dev_is_office());
