-- 2번 AI 물품 등록: 사진과 등록 원장. 게시되면 items에 호환 투영(projection)을 쓴다.
CREATE TABLE item_images (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id), content_type text NOT NULL, bytes bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE listings (id text PRIMARY KEY, data jsonb NOT NULL, owner_id text GENERATED ALWAYS AS (data->>'ownerId') STORED REFERENCES users(id), status text GENERATED ALWAYS AS (data->>'status') STORED);
CREATE INDEX listings_owner ON listings (owner_id);
CREATE INDEX listings_status ON listings (status);
