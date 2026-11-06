# 통화 캐릭터 3D 모델

명세: `docs/specs/0003-voice-call-reservation.md` 8절. 원본 Blender 파일과 내보내기 절차: `apps/web/assets-src/character/README.md`.

- `billy-mascot-v2.glb`: 통화 화면 캐릭터(팔다리 없는 정면 모델, meshopt 압축). `src/features/voice-call/Character3D.tsx`의 `CHARACTER_MODEL_URL`이 이 파일을 가리킨다.
- 애니메이션 클립 이름은 `CharacterState` 값과 같다: `IDLE`, `CONNECTING`, `GREETING`, `LISTENING`, `THINKING`, `SPEAKING`, `WAITING_APPROVAL`, `RESERVING`, `DONE`, `RETRYING`, `ERROR`. `GREETING`·`DONE`·`ERROR`는 한 번 재생 후 마지막 포즈에 멈추고 나머지는 2초 주기로 반복한다.
- 렌더러가 클립 위에 떠다니는 움직임(위아래·좌우 기울기·좌우 회전, 서로 다른 주기)과 바닥 그림자를 더한다. 1회 클립이 끝난 뒤에도 계속 움직인다.
- 모델을 받기 전, 모델을 받지 못했을 때, WebGL을 쓸 수 없을 때는 2D 캐릭터(`Character2D`)를 보여 준다. `prefers-reduced-motion`이면 떠다니는 움직임 없이 상태별 기준 포즈(반복 상태는 첫 포즈, 1회 상태는 마지막 포즈)만 그린다.
- 이 폴더의 파일은 PWA precache에서 빠지고 첫 사용 때 `call-character-models` 캐시에 30일 저장된다. 해시 없이 배포되므로 모델을 바꿀 때는 같은 이름으로 덮어쓰지 말고 `billy-mascot-v3.glb`처럼 새 이름을 쓴다.
