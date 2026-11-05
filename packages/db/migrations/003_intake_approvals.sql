-- 1번 접수: 사람이 승인한 통화 신청서로 실행한 예약 신청 도구 이력(요청당 1건).
-- 명세: docs/specs/0003-voice-call-reservation.md
CREATE TABLE intake_approvals (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  request_id text NOT NULL UNIQUE GENERATED ALWAYS AS (data->>'requestId') STORED,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  next_attempt_at timestamptz
);
CREATE INDEX intake_approvals_due ON intake_approvals (status, next_attempt_at);
