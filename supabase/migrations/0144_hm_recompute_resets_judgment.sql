-- ============================================================
-- 0144_hm_recompute_resets_judgment.sql : 再計算で総合判定がDに上がった方の就業判定を「判定保留」に戻す
-- ============================================================
-- 「判定を再計算（事務所基準）」で総合判定が D 未満 → D(または E) に上がった方のうち、
-- 就業判定が「通常勤務可」(判定条件なし)のままの方は、D になる前に(一括判定などで)判定された
-- 可能性が高い。そのままだと医師の意見が空のまま受診勧奨の対象になるため、
-- 就業判定を「判定保留」に戻して産業医の再判定を促す。
--   ・就業判定が「要就業制限」「要休業」、または「通常勤務可（受診が条件）」の方は個別に判定済みとみなし変えない
--   ・医師の意見・判定日はそのまま残す(再判定のときに見直す)
--   ・受診勧奨の状態は 0143 と同じ規則で合わせる
--   ・戻り値を {"count": 更新人数, "reset_pending": 判定保留に戻した人数} に変える(戻り値の型が変わるため作り直す)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

drop function if exists public.hm_apply_judgments(jsonb);

create function public.hm_apply_judgments(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_item jsonb;
  v_count int := 0;
  v_reset int := 0;
  v_overall text;
  v_id uuid;
  v_prev_overall text;
  v_work text;
  v_condition text;
  v_became_severe boolean;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid rows';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_id := (v_row ->> 'checkup_id')::uuid;

    -- 検査項目の判定
    if v_row ? 'items' then
      for v_item in select * from jsonb_array_elements(v_row -> 'items') loop
        update public.hm_checkup_items
           set judgment = nullif(trim(coalesce(v_item ->> 'judgment', '')), '')
         where id = (v_item ->> 'id')::uuid;
      end loop;
    end if;

    v_overall := nullif(trim(coalesce(v_row ->> 'overall_judgment', '')), '');

    select overall_judgment, work_judgment, work_judgment_condition
      into v_prev_overall, v_work, v_condition
      from public.hm_checkups where id = v_id;

    -- D 未満 → D(E) に上がったか
    v_became_severe :=
      v_overall is not null
      and upper(left(v_overall, 1)) in ('D', 'E')
      and (v_prev_overall is null or upper(left(v_prev_overall, 1)) not in ('D', 'E'));

    -- 総合判定・有所見(指定があるときのみ更新する)。
    -- 受診勧奨の状態は総合判定に合わせる(取込時の既定と同じ規則。勧奨済・受診済は変えない)。
    -- D に上がった方で就業判定が「通常勤務可」(判定条件なし)なら「判定保留」に戻して再判定を促す
    update public.hm_checkups
       set overall_judgment = coalesce(v_overall, overall_judgment),
           has_findings = coalesce((v_row ->> 'has_findings')::boolean, has_findings),
           followup_status = case
             when v_overall is null then followup_status
             when upper(left(v_overall, 1)) in ('D', 'E') and followup_status = 'none' then 'pending'
             when upper(left(v_overall, 1)) not in ('D', 'E') and followup_status = 'pending' then 'none'
             else followup_status end,
           work_judgment = case
             when v_became_severe and v_work = 'normal' and v_condition is null then 'pending'
             else work_judgment end,
           updated_at = now()
     where id = v_id;

    if v_became_severe and v_work = 'normal' and v_condition is null then
      v_reset := v_reset + 1;
      perform public.hm_log_access(
        'reset_work_judgment', 'hm_checkups', v_id,
        jsonb_build_object('reason', 'recompute_became_severe', 'from', v_prev_overall, 'to', v_overall)
      );
    end if;

    v_count := v_count + 1;
  end loop;

  perform public.hm_log_access(
    'recompute_judgments', 'hm_checkups', null,
    jsonb_build_object('count', v_count, 'reset_pending', v_reset)
  );
  return jsonb_build_object('count', v_count, 'reset_pending', v_reset);
end;
$$;

revoke all on function public.hm_apply_judgments(jsonb) from public;
grant execute on function public.hm_apply_judgments(jsonb) to authenticated;

-- 既存データ: 総合判定が D(E) で就業判定が「通常勤務可」(判定条件なし)かつ医師の意見が空の方は、
-- D になる前に判定された可能性が高いので「判定保留」に戻す(一度だけ)
update public.hm_checkups
   set work_judgment = 'pending', updated_at = now()
 where work_judgment = 'normal'
   and work_judgment_condition is null
   and work_judgment_note is null
   and overall_judgment is not null
   and upper(left(overall_judgment, 1)) in ('D', 'E');

-- 確認
select proname as 関数, pg_get_function_result(oid) as 戻り値
  from pg_proc where proname = 'hm_apply_judgments';
