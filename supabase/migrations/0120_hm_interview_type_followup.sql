-- ============================================================
-- 0120_hm_interview_type_followup.sql : 面談種別に復職後フォローアップ面談を追加
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
    'other'               -- その他・健康相談等
  ));
