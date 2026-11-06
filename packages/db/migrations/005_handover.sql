-- 3번 거점 인계·반납: 예약별 인계 코드·단계. 명세: docs/specs/0007-hub-handover-return.md
-- 거점 관리자 데모 계정. 기존 업무 데이터를 지우지 않는다(seed도 같은 사용자를 넣는다).
INSERT INTO users(id, data)
VALUES ('u_hub', '{"id":"u_hub","handle":"demo-hub","displayName":"거점 관리자","demoEligible":true}')
ON CONFLICT DO NOTHING;
-- 기존 예약에 인계 정보를 채운다. 코드는 행마다 따로 만든다(상관 서브쿼리).
UPDATE reservations SET data = data || jsonb_build_object('handover', jsonb_build_object(
  'code', (SELECT string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 31)::int, 1), '')
           FROM generate_series(1, 8) WHERE reservations.id IS NOT NULL),
  'stage', 'READY', 'pickedUpAt', NULL, 'pickupPhotoId', NULL, 'returnedAt', NULL,
  'returnPhotoId', NULL, 'comparison', NULL, 'inspection', NULL))
WHERE coalesce(data->'handover', 'null'::jsonb) = 'null'::jsonb;
CREATE UNIQUE INDEX reservations_handover_code ON reservations ((data->'handover'->>'code'));
