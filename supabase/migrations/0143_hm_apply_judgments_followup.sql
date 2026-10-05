-- ============================================================
-- 0143_hm_apply_judgments_followup.sql : 判定の再計算で総合判定が変わったら受診勧奨の状態も合わせる
-- ============================================================
-- 「判定を再計算（事務所基準）」(hm_apply_judgments) は総合判定を書き換えるが、
-- 受診勧奨の状態(followup_status)を変えていなかった。そのため、再計算で C→D になった方が
-- 「医師の指示人数(総合判定D)」には数えられるのに「受診勧奨」には入らない、というずれが生じていた。
--   ・再計算で D(または E)になり、受診勧奨が「措置不要」なら「受診勧奨」にする
--   ・再計算で D 未満になり、受診勧奨が「受診勧奨」(未対応)なら「措置不要」に戻す
--   ・担当者が更新した「勧奨済」「受診済」は変更しない
--   ・末尾で、既存データの同じずれを一度だけ直す(取込時の既定と同じ規則)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create or replace function public.hm_apply_judgments(p_rows jsonb)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_count int := 0;
  v_overall text;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    -- 検査項目の判定
    if v_row ? 'items' then
      for v_item in select * from jsonb_array_elements(v_row -> 'items') loop
        update public.hm_checkup_items
           set judgment = nullif(trim(coalesce(v_item ->> 'judgment', '')), '')
         where id = (v_item ->> 'id')::uuid;
      end loop;
    end if;

    v_overall := nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), '');

    -- 総合判定・有所見(指定があるときのみ更新する)。
    -- 受診勧奨の状態は総合判定に合わせる(取込時の既定と同じ規則。勧奨済・受診済は変えない)
    update public.hm_checkups
       set overall_judgment = coalesce(v_overall, overall_judgment),
           has_findings = coalesce((v_row ->> 'has_findings')::boolean, has_findings),
           followup_status = case
             when v_overall is null then followup_status
             when upper(left(v_overall, 1)) in ('D', 'E') and followup_status = 'none' then 'pending'
             when upper(left(v_overall, 1)) not in ('D', 'E') and followup_status = 'pending' then 'none'
             else followup_status end,
           updated_at = now()
     where id = (v_row ->> 'checkup_id')::uuid;

    v_count := v_count + 1;
  end loop;

  perform public.hm_log_access(
    'recompute_judgments', 'hm_checkups', null,
    jsonb_build_object('count', v_count)
  );
  return v_count;
end;
$$;

grant execute on function public.hm_apply_judgments(jsonb) to authenticated;

-- 既存データのずれを直す: 総合判定が D(E)なのに「措置不要」のままの方を「受診勧奨」にする
update public.hm_checkups
   set followup_status = 'pending', updated_at = now()
 where followup_status = 'none'
   and overall_judgment is not null
   and upper(left(overall_judgment, 1)) in ('D', 'E');

-- 総合判定が D 未満なのに「受診勧奨」(未対応)のままの方を「措置不要」に戻す
update public.hm_checkups
   set followup_status = 'none', updated_at = now()
 where followup_status = 'pending'
   and (overall_judgment is null or upper(left(overall_judgment, 1)) not in ('D', 'E'));

-- 確認: 企業・年度ごとに、総合判定D(E)の人数と受診勧奨(未対応+勧奨済+受診済)の人数が一致すること
select co.name as 企業, c.fiscal_year as 年度,
       count(*) filter (where upper(left(c.overall_judgment, 1)) in ('D', 'E')) as 総合判定D,
       count(*) filter (where c.followup_status in ('pending', 'recommended', 'done')) as 受診勧奨対象
  from public.hm_checkups c
  join public.companies co on co.id = c.company_id
 group by co.name, c.fiscal_year
 order by co.name, c.fiscal_year desc;
