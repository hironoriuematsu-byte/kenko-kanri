-- ============================================================
-- 0162_hm_situation_opinion.sql : 面談なしで、状況をもとに出す産業医意見
-- ============================================================
-- 産業医面談を行わず、事業場からの報告などの状況をもとに産業医意見書
-- (就業区分の判定・就業上の措置に関する意見)を出せるようにする。
--   ・面談と同じ表(hm_interviews / hm_interview_opinions)に、種別
--     'situation_opinion' として保存する。権限(RLS)・公開の仕組み・
--     カルテへの表示は面談の意見書と同じ
--   ・画面と意見書の様式は、種別を見て文言を切り替える
--     (「面談実施日」→「状況確認日」、「産業医面談は実施していません」と記載)
--
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

alter table public.hm_interviews
  drop constraint if exists hm_interviews_interview_type_check;

alter table public.hm_interviews
  add constraint hm_interviews_interview_type_check
  check (interview_type in (
    'high_stress',        -- 高ストレス面接指導
    'long_hours',         -- 長時間労働面談
    'checkup_followup',   -- 健診事後措置面談
    'return_to_work',     -- 復職面談
    'return_followup',    -- 復職後フォローアップ面談
    'other',              -- その他・健康相談等
    'situation_opinion'   -- 状況に基づく産業医意見(面談なし)
  ));
