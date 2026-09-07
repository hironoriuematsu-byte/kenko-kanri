-- ============================================================
-- 0123: 実施事務従事者・従業員が事業者担当者を兼ねる場合への対応
--
-- ストレスチェックWeb側の profiles に hm_company_access という列が
-- 追加された(stres の 0017_hm_company_access.sql)。true の人は
-- 「健康管理Webでは事業者担当者(company)として扱う」。
--
-- ストレスチェックWeb側の role は変えないため、ストレスチェックでの
-- 権限(実施事務従事者・従業員)はこれまでどおり。この読み替えが効くのは
-- 健康管理Webだけである。
--
-- 【前提】ストレスチェックWebの 0017_hm_company_access.sql を先に適用しておく
-- ============================================================

create or replace function public.hm_my_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select case
           when coalesce(hm_company_access, false) and role in ('employee', 'jimu')
             then 'company'
           else role
         end
    from public.profiles
   where id = auth.uid()
$$;


-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select * from (
  values
    ('profiles.hm_company_access(ストレスチェックWeb側で追加)',
     (select case when count(*) > 0 then '✅OK' else '❌先に stres の 0017 を適用してください' end
        from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'hm_company_access')),
    ('hm_my_role() の読み替え',
     (select case when pg_get_functiondef(p.oid) like '%hm_company_access%' then '✅OK' else '❌未適用' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'hm_my_role'))
) as t(内容, 状態);
