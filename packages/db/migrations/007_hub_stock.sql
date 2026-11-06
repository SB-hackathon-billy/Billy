-- 캠퍼스 거점에도 센터 물품을 나눠 둔다(운영 데이터 유지). showcase의 배치와 같은 규칙이다.
-- 센터 앞에서만 빌리던 공공 물품에 거점 2곳을 돌아가며 더한다. 이미 거점이 있는 물품과 새 DB(물품 없음)는 그대로다.
WITH hubs(i, id) AS (
  VALUES (0, 'place-hansung'), (1, 'place-sungshin'), (2, 'place-korea'),
         (3, 'place-kookmin'), (4, 'place-dongduk'), (5, 'place-seokyeong')
), pub AS (
  SELECT id, (row_number() OVER (ORDER BY id) - 1) AS n
  FROM items
  WHERE data->>'source' = 'PUBLIC' AND data->'allowedPlaceIds' = '["place-center"]'::jsonb
)
UPDATE items SET data = jsonb_set(items.data, '{allowedPlaceIds}', jsonb_build_array(
  'place-center',
  (SELECT id FROM hubs WHERE i = (pub.n * 2) % 6),
  (SELECT id FROM hubs WHERE i = (pub.n * 2 + 1) % 6)))
FROM pub
WHERE items.id = pub.id AND EXISTS (SELECT 1 FROM places WHERE id = 'place-hansung');
-- 시연 이웃 물품도 새 거점에서 주고받는다(있을 때만).
UPDATE items SET data = jsonb_set(data, '{allowedPlaceIds}', v.places::jsonb)
FROM (VALUES
  ('res-speaker-seul', '["place-sungshin","place-dongduk"]'),
  ('res-headset-jun', '["place-korea","place-kookmin"]'),
  ('res-waffle-duri', '["place-seokyeong","place-hansung"]'),
  ('res-polaroid-duri', '["place-kookmin","place-seokyeong"]'),
  ('res-mic-seul', '["place-dongduk","place-sungshin"]')
) AS v(id, places)
WHERE items.id = v.id;
