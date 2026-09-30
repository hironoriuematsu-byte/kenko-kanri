-- ============================================================
-- 0137_hm_mark_interview_done.sql : 意見書の公開で面談を「実施済」にする
-- ============================================================
-- 産業医面談は、実施したら必ず意見書を書いて企業側に公開するため、
-- 実施記録の「実施済にする」チェックをやめ、意見書を公開したときに実施済にする。
--   ・hm_mark_interview_done(p_id, p_conducted_date): 面談を実施済にする(officeのみ)。
--     実施日が未入力なら意見書の面談実施日を入れる。すでに実施済ならそのまま
--   ・status 列は列単位の更新権限を与えていないため、RPC 経由でのみ変更する(従来どおり)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create or replace function public.hm_mark_interview_done(
  p_id uuid,
  p_conducted_date date default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_interviews
     set status = 'done',
         conducted_date = coalesce(conducted_date, p_conducted_date),
         updated_at = now()
   where id = p_id
     and status <> 'cancelled';
  if not found then
    raise exception 'interview not found or cancelled';
  end if;
  perform public.hm_log_access('mark_done', 'hm_interviews', p_id, null);
end;
$$;

revoke all on function public.hm_mark_interview_done(uuid, date) from public;
grant execute on function public.hm_mark_interview_done(uuid, date) to authenticated;

-- 確認: 関数が作られていること
select proname from pg_proc where proname = 'hm_mark_interview_done';
