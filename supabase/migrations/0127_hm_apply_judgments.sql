-- ============================================================
-- 0127_hm_apply_judgments.sql : 保存済みの判定を入れ直す
-- ============================================================
-- 判定基準を変更したときや、取込時の判定に誤りが見つかったときに、
-- 取り込み済みの健診結果の判定を事務所基準で計算し直して保存する。
--
-- 計算はアプリ側(判定基準の設定に従う)で行い、この関数は結果を
-- 書き込むだけを担う。実施者のみ・監査ログに記録する。
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

    -- 総合判定・有所見(指定があるときのみ更新する)
    update public.hm_checkups
       set overall_judgment = coalesce(
             nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), ''),
             overall_judgment
           ),
           has_findings = coalesce((v_row ->> 'has_findings')::boolean, has_findings),
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


-- ------------------------------------------------------------
-- 適用状況の確認
-- ------------------------------------------------------------
select case when count(*) > 0 then '✅OK' else '❌未適用' end as 状態,
       'hm_apply_judgments(判定の再計算の保存)' as 内容
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'hm_apply_judgments';
