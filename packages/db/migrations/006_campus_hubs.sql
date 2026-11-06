-- 캠퍼스 거점 6곳(기획서 v2 3장 ②). 빌려주기 장소는 이 거점만 고를 수 있다(contracts CAMPUS_HUB_PLACE_IDS).
-- 운영 데이터를 지우지 않고 없는 거점만 더한다. seed는 places를 다시 채우므로 테스트 fixture에는 영향이 없다.
INSERT INTO places(id, data) VALUES
  ('place-korea', '{"id":"place-korea","label":"고려대 거점","description":"고려대학교 캠퍼스 안 학생 관리자 거점.","isDemo":true}'),
  ('place-kookmin', '{"id":"place-kookmin","label":"국민대 거점","description":"국민대학교 캠퍼스 안 학생 관리자 거점.","isDemo":true}'),
  ('place-dongduk', '{"id":"place-dongduk","label":"동덕여대 거점","description":"동덕여자대학교 캠퍼스 안 학생 관리자 거점.","isDemo":true}'),
  ('place-seokyeong', '{"id":"place-seokyeong","label":"서경대 거점","description":"서경대학교 캠퍼스 안 학생 관리자 거점.","isDemo":true}'),
  ('place-sungshin', '{"id":"place-sungshin","label":"성신여대 거점","description":"성신여자대학교 캠퍼스 안 학생 관리자 거점.","isDemo":true}'),
  ('place-hansung', '{"id":"place-hansung","label":"한성대 거점","description":"한성대학교 캠퍼스 안 학생 관리자 거점. 평일 저녁·주말 낮에 인계·반납해요.","isDemo":true}')
ON CONFLICT DO NOTHING;
