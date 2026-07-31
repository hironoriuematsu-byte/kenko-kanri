-- ============================================================
-- 0105_hm_stress_link_template.sql : 本番用ストレスチェック連携(テンプレート)
-- ============================================================
-- ※※※ このままでは実行しない ※※※
-- 本運用移行時に、既存ストレスチェックWebの実テーブル
-- (results / interview_requests / profiles)の実際の列名を確認し、
-- 下のTODO箇所を調整してから本番プロジェクトで実行する。
-- 既存テーブルは読み取りのみ(スキーマ変更・書き込みは一切行わない)。
-- 関数のシグネチャ(名前・引数・戻り値)は開発用モック
-- (dev_setup/0002_dev_stress_mock.sql)と同一のため、アプリ側の変更は不要。
-- ============================================================

/* -------- 調整のうえコメントを外して実行 --------

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
    'view_high_stress', 'results', null,
    jsonb_build_object('company_id', p_company_id, 'fiscal_year', p_fiscal_year)
  );
  return query
    select
      r.user_id,
      p.full_name,                    -- TODO: profilesの氏名列名を確認
      p.employee_no,                  -- TODO: profilesの社員番号列名を確認
      exists (
        select 1 from public.interview_requests ir   -- TODO: 申出テーブルの構造を確認
        where ir.user_id = r.user_id
          and ir.fiscal_year = r.fiscal_year          -- TODO: 年度列の有無を確認
      )
    from public.results r
    join public.profiles p on p.id = r.user_id
    where p.company_id = p_company_id
      and r.fiscal_year = p_fiscal_year
      and r.is_high_stress = true     -- TODO: 高ストレス判定列名(is_high_stress等)を確認
    order by p.employee_no nulls last, p.full_name;
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
  select count(*), count(*) filter (where r.is_high_stress)  -- TODO: 列名確認
    into v_total, v_high
    from public.results r
    join public.profiles p on p.id = r.user_id
   where p.company_id = p_company_id and r.fiscal_year = p_fiscal_year;
  return query select
    v_total,
    case when v_total >= 10 then v_high else null end,
    case when v_total >= 10 then round(v_high::numeric * 100 / v_total, 1) else null end;
end;
$$;

-- 個人のストレスチェック歴(officeのみ・ログ記録)
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
  perform public.hm_log_access('view_stress_history', 'results', p_user_id, null);
  return query
    select
      r.fiscal_year,
      r.is_high_stress,               -- TODO: 列名確認
      exists (
        select 1 from public.interview_requests ir
        where ir.user_id = r.user_id and ir.fiscal_year = r.fiscal_year
      )
    from public.results r
    where r.user_id = p_user_id
    order by r.fiscal_year desc;
end;
$$;

------------------------------------------------- */

select 'このファイルはテンプレートです。本運用移行時に列名を確認して調整してください。' as note;
