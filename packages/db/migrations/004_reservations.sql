-- 3번 탐색·대여 관리: 예약 원장·응답 이력·대기열·앱 알림.
-- 명세: docs/specs/0004-reservations-waitlist-notifications.md
CREATE TABLE reservations (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  item_id text NOT NULL REFERENCES items(id),
  requester_id text NOT NULL REFERENCES users(id),
  owner_id text REFERENCES users(id),
  request_id text REFERENCES rental_requests(id),
  status text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','DECLINED','CANCELLED','EXPIRED')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  response_due_at timestamptz,
  CHECK (start_at < end_at),
  -- 중복 점유의 최종 보증: 확정 예약은 같은 물품에서 기간이 겹칠 수 없다.
  EXCLUDE USING gist (item_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status = 'CONFIRMED')
);
-- 접수 요청(협상 선택)에서 확정하는 예약은 요청당 1건.
CREATE UNIQUE INDEX reservations_one_per_request ON reservations (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX reservations_requester ON reservations (requester_id);
CREATE INDEX reservations_owner ON reservations (owner_id);
CREATE INDEX reservations_item_status ON reservations (item_id, status);
CREATE INDEX reservations_pending_due ON reservations (response_due_at) WHERE status = 'PENDING';

-- 응답 이력(추가 전용).
CREATE TABLE reservation_events (
  reservation_id text NOT NULL REFERENCES reservations(id),
  seq integer NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (reservation_id, seq)
);
CREATE TRIGGER reservation_events_immutable BEFORE UPDATE ON reservation_events FOR EACH ROW EXECUTE FUNCTION immutable_record();

-- 대기열: seq가 선착순 순서다.
CREATE TABLE waitlist_entries (
  id text PRIMARY KEY,
  seq bigserial NOT NULL UNIQUE,
  data jsonb NOT NULL,
  item_id text NOT NULL REFERENCES items(id),
  user_id text NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('WAITING','NOTIFIED','APPLIED','FULFILLED','EXPIRED','CANCELLED')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  priority_until timestamptz,
  CHECK (start_at < end_at)
);
CREATE INDEX waitlist_item_open ON waitlist_entries (item_id, seq) WHERE status IN ('WAITING','NOTIFIED','APPLIED');
CREATE INDEX waitlist_user ON waitlist_entries (user_id, seq);

-- 앱 내 알림.
CREATE TABLE notifications (
  id text PRIMARY KEY,
  seq bigserial NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz
);
CREATE INDEX notifications_user ON notifications (user_id, seq);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;
