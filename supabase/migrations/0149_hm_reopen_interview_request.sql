-- ============================================================
-- 0149_hm_reopen_interview_request.sql : 面接指導の申出の「実施済を取り消す」を面談管理にも反映する
-- ============================================================
-- ストレスチェックWebで申出の「実施済」を取り消して、申出受付・日程調整済に戻したとき:
--   * 面談管理に予定がなければ、新しく登録する(0148 の仕組み。実施済のままの申出は登録しないため)
--   * 面談管理に「実施済」の予定があれば、「予定」に戻す(実施記録・意見書はそのまま残る)
-- 0148 のトリガーの関数を差し替えるだけ。0148 の実行後に実行する
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

create or replace function public.hm_on_interview_request_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new; -- 面談管理からの書き戻しでは呼ばない(行き来を防ぐ)
  end if;
  begin
    -- 実施済を取り消したとき: 面談管理の「実施済」も「予定」に戻す
    if tg_op = 'UPDATE' and old.status = 'done' and new.status in ('pending', 'scheduled') then
      update public.hm_interviews
         set status = 'scheduled', updated_at = now()
       where interview_request_id = new.id
         and status = 'done';
    end if;
    perform public.hm_link_interview_request(new.id);
  exception when others then
    raise warning 'hm_link_interview_request failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- 適用状況の確認
select '0149 実施済の取り消しを面談管理に反映' as 項目,
       case when pg_get_functiondef('public.hm_on_interview_request_change'::regproc) like '%old.status = ''done''%'
            then '✅OK' else '❌未適用' end as 状態;
