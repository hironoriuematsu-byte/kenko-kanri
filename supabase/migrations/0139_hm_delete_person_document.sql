-- ============================================================
-- 0139_hm_delete_person_document.sql : 産業医作成文書(診療情報提供依頼書など)の削除
-- ============================================================
-- hm_person_documents は直接の delete を許可していない(0106)。
-- 実施者(office)だけが、理由を添えて RPC 経由で削除できるようにし、操作をアクセスログに残す。
--   ・hm_delete_person_document(p_id, p_reason): 物理削除(文書は産業医が作成した下書き・依頼文であり、
--     カルテの書類(hm_person_files)や健診・面談の記録とは別のため、論理削除にはしない)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create or replace function public.hm_delete_person_document(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_title text;
  v_person uuid;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  select title, person_id into v_title, v_person from public.hm_person_documents where id = p_id;
  if v_person is null then
    raise exception 'document not found';
  end if;
  delete from public.hm_person_documents where id = p_id;
  perform public.hm_log_access(
    'delete', 'hm_person_documents', p_id,
    jsonb_build_object('title', v_title, 'person_id', v_person, 'reason', p_reason)
  );
end;
$$;

revoke all on function public.hm_delete_person_document(uuid, text) from public;
grant execute on function public.hm_delete_person_document(uuid, text) to authenticated;

-- 確認: 関数があること
select proname from pg_proc where proname = 'hm_delete_person_document';
