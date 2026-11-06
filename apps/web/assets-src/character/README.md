# 통화 마스코트 원본 에셋

명세: `docs/specs/0003-voice-call-reservation.md` 8절. 이 폴더는 빌드·배포에 포함되지 않는 원본이다. 앱은 여기서 내보낸 `apps/web/public/models/character/billy-mascot-v2.glb`를 `Character3D`(`src/features/voice-call/Character3D.tsx`)로 그린다.

- `billy-mascot.blend`: Blender 5.2에서 만든 모델·리그·상태별 액션. 외부 텍스처 없음(재질 색만 사용). 팔다리 없는 몸통 캐릭터이고 정면을 본다.
- `billy-mascot-states.png`: 11개 상태 기준 포즈 렌더(Stage 카메라, 반복 상태는 첫 프레임, 1회 상태는 마지막 프레임).
- 연결 대기 화면 아바타 `src/features/voice-call/assets/mascot-avatar.webp`(384px, 투명 배경)도 이 파일의 `IDLE` 첫 프레임을 소품 없이 정면에서 렌더한 것이다.

## 구조

- 오브젝트는 모두 `MascotRig` 본에 Bone 부모로 붙은 강체 파츠다. 스키닝은 없다.
- 몸 본(`Body` 본 컬렉션): `root` > `body`(찌그러짐·늘어남, 피벗은 몸 바닥) > `leaf`(잎), `face`(표정 파츠의 부모). 팔·발 본과 메시는 v2에서 없앴다.
- 표정 본(`Expression`): `eye_open`·`eye_happy`·`eye_closed`·`eye_squint`(.L/.R), `brow_worried`(.L/.R), `mouth_smile`·`mouth_o`·`mouth_flat`·`mouth_frown`. 본 scale 1이면 보이고 0.001이면 숨는다. 0은 쓰지 않는다: glTF 내보내기가 본에 붙은 오브젝트의 변환을 현재 포즈 기준으로 계산해서, 0이면 자식 노드의 scale이 0으로 굳는다.
- 소품 본(`Props`): `bubble_voice`, `bubble_speak`, `bubble_think`, `bubble_check`, `bubble_retry`, `badge_alert`, `fx_dots`, `fx_waves`, `fx_sparks`, `card_approval`, `calendar_retry`. 표정과 같은 scale 토글. 들어 줄 손이 없으므로 `card_approval`은 몸 오른쪽 아래에 떠 있다.
- `.L`/`.R`는 캐릭터 기준 좌우(`.L` = +X). 정면은 -Y이고 glTF로 내보내면 +Z가 된다.
- `Stage` 컬렉션(카메라·조명·월드)은 미리보기용이며 내보내지 않는다. 카메라는 정면(-Y 쪽, 70mm)에서 몸 중심을 본다. `Character3D.tsx`의 카메라가 같은 위치(Y-up으로 변환)를 쓴다.

## 액션

`CharacterState` 값과 같은 이름의 액션 11개. 반복 액션은 1~61프레임(30fps, 2초)이고 61프레임이 1프레임과 같다. 1회 액션은 기준 포즈로 끝난다. 본 로컬 축: X = 좌우, Y = 위, Z = 앞(-Y)이므로 기울기는 Z 회전, 끄덕임은 X 회전, 찌그러짐은 Y scale이다.

| 액션               | 표정                                         | 소품                      | 움직임                                                           | 재생           |
| ------------------ | -------------------------------------------- | ------------------------- | ---------------------------------------------------------------- | -------------- |
| `IDLE`             | eye_open, mouth_smile                        | fx_sparks                 | 숨쉬기, 좌우 기울기, 잎 흔들림, 소품 오르내림, 반짝임, 눈 깜빡임 | 반복           |
| `CONNECTING`       | eye_happy, mouth_smile                       | fx_dots                   | 빠른 숨쉬기, 점 세 개가 돌며 오르내림                            | 반복           |
| `GREETING`         | eye_happy, mouth_smile                       | bubble_voice, fx_sparks   | 몸을 좌우로 흔들며 인사(줄어드는 진폭), 말풍선 튀어나옴          | 1회 → SPEAKING |
| `LISTENING`        | eye_closed, mouth_o                          | fx_waves                  | 음파 쪽으로 기울어 끄덕임, 음파 맥동                             | 반복           |
| `THINKING`         | eye_open(위로 시선), mouth_flat              | bubble_think              | 느린 갸웃거림, 말풍선 떠다님, 눈 깜빡임                          | 반복           |
| `SPEAKING`         | eye_open.R + eye_squint.L(윙크), mouth_smile | bubble_speak, fx_sparks   | 입 벌림 반복(말하기), 작은 들썩임, 말풍선 맥동                   | 반복           |
| `WAITING_APPROVAL` | eye_happy, mouth_smile                       | card_approval, fx_sparks  | 숨쉬기, 카드가 떠서 흔들림                                       | 반복           |
| `RESERVING`        | eye_squint, mouth_smile ×1.2                 | calendar_retry, fx_sparks | 빠른 들썩임, 달력 흔들림                                         | 반복           |
| `DONE`             | eye_happy, mouth_smile                       | bubble_check, fx_sparks   | 웅크렸다 뛰어오른 뒤 착지·정지, 체크 말풍선 튀어나옴             | 1회 후 정지    |
| `RETRYING`         | eye_squint, mouth_o                          | bubble_retry, fx_sparks   | 좌우 기울기, 말풍선 흔들림                                       | 반복           |
| `ERROR`            | eye_open, brow_worried, mouth_frown          | badge_alert               | 고개 젓기 후 앞으로 처짐, 잎 처짐, 경고 배지 튀어나옴            | 1회 후 정지    |

- 떠다니는 움직임(위아래 3.2초, 기울기 4.7초, 좌우 회전 6.3초)과 바닥 그림자는 액션이 아니라 `Character3D.tsx`가 그린다. 1회 액션이 멈춘 뒤에도 캐릭터가 계속 떠 있게 하려는 것이다. 액션에 `root` 위치 움직임을 넣으면(예: `DONE` 점프) 그 위에 더해진다.
- 모든 액션은 모든 본의 location·rotation·scale을 키로 갖는다. 새 액션을 만들 때도 전체 본을 키로 넣어야 액션을 바꿀 때 이전 상태의 토글이 남지 않는다.
- 토글 scale 키는 Constant 보간으로 넣는다. 중간값이 되면 파츠가 반쯤 커진 프레임이 생긴다.
- 액션은 Fake User로 저장돼 있다. 새로 만든 액션도 Fake User를 켜야 파일 저장·내보내기에서 빠지지 않는다.
- 반복 액션은 첫 프레임과 마지막 프레임 포즈를 같게 만든다. 액션 Frame Range(Manual)를 키 범위에 맞추고, 반복 액션만 Cyclic을 켠다.
- 토글로 켜진 소품의 크기 변화(튀어나옴·맥동)는 Constant가 아닌 보간으로 넣는다. 꺼진 소품(0.001)은 건드리지 않는다.

## 내보내기 (glTF 2.0)

1. 리그의 Pose Position이 `Pose`이고 액션(보통 `IDLE`)이 지정된 상태에서 시작한다. `Rest`로 두면 모든 액션이 기본 포즈로 구워진다.
2. `Mascot` 컬렉션의 오브젝트만 선택한다.
3. File > Export > glTF 2.0: Format `glTF Binary (.glb)`, Include `Selected Objects`, Mesh `Apply Modifiers` 켜기, Animation 모드 `Actions`, Sampling Animations 켜기.
4. meshopt로 압축한다: `npx @gltf-transform/cli meshopt raw.glb billy-mascot-vN.glb`. `optimize`는 메시 합치기·단순화·키프레임 재샘플링까지 하므로 쓰지 않는다.
5. 결과를 `apps/web/public/models/character/`에 두고 `Character3D.tsx`의 `CHARACTER_MODEL_URL`을 바꾼다(아래 캐시 참고).

`billy-mascot-v2.glb`: 압축 전 959KB → meshopt 357KB, 애니메이션 11개(반복 2초, `GREETING`·`ERROR` 1.17초, `DONE` 1.3초), 채널 90개(본 30개). `gltf-transform validate` 오류·경고 없음(정보 2건: meshopt 확장은 검사기가 지원하지 않음, 미사용 버퍼 표시).

### 압축

- 렌더러는 meshopt 디코더(`MeshoptDecoder`)만 설정돼 있다. Draco나 KTX2를 쓰면 `Character3D.tsx`에 DRACOLoader·KTX2Loader를 추가해야 한다.
- 지금은 텍스처가 없다. 텍스처를 KTX2로 압축하려면 KTX-Software의 `toktx`가 PATH에 있어야 하고, 없으면 WebP를 쓴다.

### 캐시

`public/`의 파일은 해시 없이 그대로 배포되고, PWA는 `/models/character/` 아래 파일을 `CacheFirst`로 30일 보관한다. 같은 이름으로 덮어쓰면 기존 사용자는 이전 모델을 계속 본다. 바꿀 때마다 `billy-mascot-v3.glb`처럼 이름을 바꾸고 `CHARACTER_MODEL_URL`도 함께 바꾼다.
