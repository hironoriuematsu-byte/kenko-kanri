-- ============================================================
-- 0002_dev_stress_mock.sql : 開発用ストレスチェック連携モック
-- ============================================================
-- ※※※ 本番では絶対に実行しない ※※※
-- 本番には既存ストレスチェックWebの results / interview_requests があるため、
-- 本番用は 0105_hm_stress_link_template.sql を実データの列名に合わせて
-- 調整してから適用する。このファイルは開発用の代替(モック)。
-- アプリは下の3つのRPC関数だけを呼ぶため、本番では関数の中身だけ差し替えればよい。
-- ============================================================

create table if not exists public.dev_stress_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                         -- 従業員アカウント(任意)
  full_name text not null,
  employee_no text,
  company_id uuid not null references public.companies(id),
  fiscal_year int not null,
  is_high_stress boolean not null default false,
  interview_requested boolean not null default false  -- 面接指導の申出
);

alter table public.dev_stress_results enable row level security;
-- 直接アクセスは不可(ポリシーなし)。下のSECURITY DEFINER RPCのみが読む

-- 高ストレス者一覧(officeのみ・ログ記録)
create or replace function public.hm_high_stress_list(
  p_company_id uuid,
  p_fiscal_year int
)
returns table (
  user_id uuid,
  full_name text,
  employee_no text,
  interview_requested boolean
)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  perform public.hm_log_access(
    'view_high_stress', 'stress_results', null,
    jsonb_build_object('company_id', p_company_id, 'fiscal_year', p_fiscal_year)
  );
  return query
    select r.user_id, r.full_name, r.employee_no, r.interview_requested
    from public.dev_stress_results r
    where r.company_id = p_company_id
      and r.fiscal_year = p_fiscal_year
      and r.is_high_stress
    order by r.employee_no nulls last, r.full_name;
end;
$$;

-- 集団サマリー(office / company自社)。10名未満は率を返さない
create or replace function public.hm_stress_summary(
  p_company_id uuid,
  p_fiscal_year int
)
returns table (
  total int,
  high_stress int,
  high_stress_rate numeric
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_total int;
  v_high int;
begin
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and p_company_id = public.hm_my_company())
  ) then
    raise exception 'permission denied';
  end if;
  select count(*), count(*) filter (where r.is_high_stress)
    into v_total, v_high
    from public.dev_stress_results r
   where r.company_id = p_company_id and r.fiscal_year = p_fiscal_year;
  return query select
    v_total,
    case when v_total >= 10 then v_high else null end,
    case when v_total >= 10 then round(v_high::numeric * 100 / v_total, 1) else null end;
end;
$$;

-- 個人のストレスチェック歴(officeのみ・ログ記録) 個人統合ビュー用
create or replace function public.hm_stress_history(p_user_id uuid)
returns table (
  fiscal_year int,
  is_high_stress boolean,
  interview_requested boolean
)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  perform public.hm_log_access('view_stress_history', 'stress_results', p_user_id, null);
  return query
    select r.fiscal_year, r.is_high_stress, r.interview_requested
    from public.dev_stress_results r
    where r.user_id = p_user_id
    order by r.fiscal_year desc;
end;
$$;

-- ============================================================
-- 動作確認用モックデータの作り方(SQL Editorで実行):
--
-- insert into dev_stress_results
--   (full_name, employee_no, company_id, fiscal_year, is_high_stress, interview_requested)
-- select v.name, v.no, c.id, 2026, v.hs, v.req
-- from (values
--   ('山田 太郎', '1001', true,  true),
--   ('佐藤 花子', '1002', false, false),
--   ('鈴木 一郎', '1003', true,  false)
-- ) as v(name, no, hs, req)
-- cross join (select id from companies where name = 'テスト株式会社') c;
--
-- ※ 高ストレス率の10名未満非表示ルールを確認したい場合は10名以上入れてください
-- ============================================================
