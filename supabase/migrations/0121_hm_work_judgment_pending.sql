-- ============================================================
-- 0121_hm_work_judgment_pending.sql : 就業判定に「判定保留」を追加
-- ============================================================
--   * 就業判定の選択肢: 通常勤務可 / 就業制限が必要 / 要休業 / 判定保留
--   * 判定保留は「要対応」として各画面で集計・強調する
--   * 健診の事後措置(followup_status)は画面から廃止し、就業判定に一本化する
--     (列とデータは監査のため残す)
-- ============================================================

alter table public.hm_checkups
  drop constraint if exists hm_checkups_work_judgment_check;

alter table public.hm_checkups
  add constraint hm_checkups_work_judgment_check
  check (work_judgment in ('normal', 'restricted', 'leave', 'pending'));

-- 一括判定RPCを「判定保留」に対応させる
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
  if p_judgment not in ('normal', 'restricted', 'leave', 'pending') then
    raise exception 'invalid judgment';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'no ids';
  end if;

  update public.hm_checkups
     set work_judgment = p_judgment,
         work_judgment_note = case
           when p_note is null then work_judgment_note
           else nullif(p_note, '')
         end,
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

-- 医師の意見のみを更新するRPC(一覧からの編集用)
create or replace function public.hm_save_work_judgment_note(p_id uuid, p_note text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_checkups
     set work_judgment_note = nullif(p_note, ''),
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'checkup not found';
  end if;
  perform public.hm_log_access('work_judgment_note', 'hm_checkups', p_id, null);
end;
$$;
