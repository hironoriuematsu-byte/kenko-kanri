-- ============================================================
-- 0138_hm_log_once_for_autosave.sql : 事前情報・実施記録の自動保存でログが増えすぎないようにする
-- ============================================================
-- 事前情報と実施記録は入力が止まるたびに自動保存する。保存のたびにアクセスログを
-- 残すと同じ内容の行が大量に並ぶため、「同じ人・同じ面談・同じ操作」のログは
-- 1時間に1行だけ残す(誰がいつごろ編集したかの記録は残る)。
--   ・hm_log_access_once(p_action, p_target_table, p_target_id, p_window):
--     直近 p_window 以内に同じ記録があれば書かない
--   ・hm_save_interview_record / hm_save_interview_pre_info をこれを使うよう作り直す
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create or replace function public.hm_log_access_once(
  p_action text,
  p_target_table text,
  p_target_id uuid,
  p_window interval default interval '1 hour'
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (
    select 1 from public.hm_access_logs
     where user_id = auth.uid()
       and action = p_action
       and target_table = p_target_table
       and target_id is not distinct from p_target_id
       and created_at > now() - p_window
  ) then
    return;
  end if;
  insert into public.hm_access_logs (user_id, action, target_table, target_id, detail)
  values (auth.uid(), p_action, p_target_table, p_target_id, null);
end;
$$;

revoke all on function public.hm_log_access_once(text, text, uuid, interval) from public;

-- 実施記録の保存(0102 と同じ内容。ログだけ1時間に1行にする)
create or replace function public.hm_save_interview_record(
  p_id uuid,
  p_conducted_date date,
  p_findings text,
  p_guidance text,
  p_private_memo text,
  p_mark_done boolean default false
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
     set conducted_date = p_conducted_date,
         findings = p_findings,
         guidance = p_guidance,
         private_memo = p_private_memo,
         status = case when p_mark_done then 'done' else status end,
         updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'interview not found';
  end if;
  perform public.hm_log_access_once('save_record', 'hm_interviews', p_id);
end;
$$;

-- 事前情報の保存(0108 と同じ内容。ログだけ1時間に1行にする)
create or replace function public.hm_save_interview_pre_info(p_id uuid, p_text text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.hm_interviews where id = p_id;
  if v_company is null then
    raise exception 'interview not found';
  end if;
  if not (
    public.hm_is_office()
    or (public.hm_my_role() = 'company' and v_company = public.hm_my_company())
  ) then
    raise exception 'permission denied';
  end if;
  update public.hm_interviews
     set pre_info = nullif(p_text, ''), updated_at = now()
   where id = p_id;
  perform public.hm_log_access_once('save_pre_info', 'hm_interviews', p_id);
end;
$$;

-- 確認: 3つの関数があること
select proname from pg_proc
 where proname in ('hm_log_access_once', 'hm_save_interview_record', 'hm_save_interview_pre_info')
 order by proname;
