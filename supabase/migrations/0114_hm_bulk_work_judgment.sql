-- ============================================================
-- 0114_hm_bulk_work_judgment.sql : 就業判定の一括入力
-- ============================================================
-- 産業医の判定作業を短縮するため、複数人の就業判定をまとめて登録する。
-- 判定日は実行日(current_date)を自動設定。officeのみ・ログ記録。
-- ============================================================

create or replace function public.hm_bulk_work_judgment(
  p_ids uuid[],
  p_judgment text,
  p_note text default null
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  if p_judgment not in ('normal', 'restricted', 'leave') then
    raise exception 'invalid judgment';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'no ids';
  end if;

  update public.hm_checkups
     set work_judgment = p_judgment,
         work_judgment_note = coalesce(nullif(p_note, ''), work_judgment_note),
         work_judgment_date = current_date,
         updated_at = now()
   where id = any (p_ids);
  get diagnostics v_count = row_count;

  perform public.hm_log_access(
    'bulk_work_judgment', 'hm_checkups', null,
    jsonb_build_object('ids', to_jsonb(p_ids), 'judgment', p_judgment, 'count', v_count)
  );
  return v_count;
end;
$$;
