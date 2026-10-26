-- ============================================================
-- 0151_hm_opinion_report_mail.sql : 意見書の発行を事業者担当者にメールで知らせる
-- ============================================================
-- 面談の画面の「事業者担当者にメールで報告」から、産業医面談が終わり意見書が発行されたことを
-- その企業の事業者担当者にメールで知らせる(メールには氏名・健康情報を書かず、詳細は健康管理Webで確認してもらう)。
--
--   * hm_opinion_report_targets(): 送り先(その企業の事業者担当者のメールアドレス)。実施者のみ・公開済みの意見書のみ
--   * hm_mark_opinion_reported(): 送った日時と人数を意見書に記録する(画面に「報告済み」と表示する)
--   事業者担当者 = 健康管理Webで company として扱われる人(hm_my_role と同じ判定:
--     role が company、または hm_company_access の付いた従業員・実施事務従事者)
--
-- 方針: 追加のみ / hm_ 接頭辞 / SECURITY DEFINER
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

alter table public.hm_interview_opinions add column if not exists reported_at timestamptz; -- 事業者担当者にメールで報告した日時
alter table public.hm_interview_opinions add column if not exists reported_to int;         -- 報告したメールの宛先の人数

-- ------------------------------------------------------------
-- 1. 送り先(実施者のみ・公開済みの意見書のみ)
-- ------------------------------------------------------------
create or replace function public.hm_opinion_report_targets(p_interview_id uuid)
returns table (name text, email text)
language plpgsql security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_published boolean;
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  select o.company_id, o.published into v_company, v_published
    from public.hm_interview_opinions o where o.interview_id = p_interview_id;
  if v_company is null then
    raise exception 'opinion not found';
  end if;
  if not v_published then
    raise exception 'opinion not published';
  end if;
  return query
    select p.name, u.email::text
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where p.company_id = v_company
       and u.email is not null
       and (
         p.role = 'company'
         or (coalesce((to_jsonb(p) ->> 'hm_company_access')::boolean, false) and p.role in ('employee', 'jimu'))
       )
     order by p.name;
end;
$$;

revoke all on function public.hm_opinion_report_targets(uuid) from public, anon;
grant execute on function public.hm_opinion_report_targets(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. 送った記録(実施者のみ)
-- ------------------------------------------------------------
create or replace function public.hm_mark_opinion_reported(p_interview_id uuid, p_count int)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.hm_is_office() then
    raise exception 'permission denied: office only';
  end if;
  update public.hm_interview_opinions
     set reported_at = now(), reported_to = p_count
   where interview_id = p_interview_id;
  perform public.hm_log_access('report_mail', 'hm_interview_opinions', p_interview_id, jsonb_build_object('recipients', p_count));
end;
$$;

revoke all on function public.hm_mark_opinion_reported(uuid, int) from public, anon;
grant execute on function public.hm_mark_opinion_reported(uuid, int) to authenticated;

-- 適用状況の確認
select * from (
  values
    ('意見書の報告メールの記録(列)',
     (select case when count(*) = 2 then '✅OK' else '❌未適用' end
        from information_schema.columns
       where table_schema = 'public' and table_name = 'hm_interview_opinions' and column_name in ('reported_at', 'reported_to'))),
    ('送り先の取得(関数)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end from pg_proc where proname = 'hm_opinion_report_targets')),
    ('送った記録(関数)',
     (select case when count(*) > 0 then '✅OK' else '❌未適用' end from pg_proc where proname = 'hm_mark_opinion_reported'))
) as t(項目, 状態);
