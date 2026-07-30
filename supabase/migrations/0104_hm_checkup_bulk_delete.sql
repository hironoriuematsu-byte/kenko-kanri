-- ============================================================
-- 0104_hm_checkup_bulk_delete.sql : 健診記録の一括削除RPC
-- ============================================================
-- 取込ミスの修正用。officeのみ・理由必須・件数と対象IDを監査ログに記録。
-- ============================================================

create or replace function public.hm_delete_checkups(p_ids uuid[], p_reason text)
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
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason required';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'no ids';
  end if;

  perform public.hm_log_access(
    'bulk_delete', 'hm_checkups', null,
    jsonb_build_object(
      'ids', to_jsonb(p_ids),
      'count', array_length(p_ids, 1),
      'reason', p_reason
    )
  );

  delete from public.hm_checkups where id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
