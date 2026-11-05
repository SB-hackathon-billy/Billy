# 통화 캐릭터 3D 모델 자리

명세: `docs/specs/0003-voice-call-reservation.md` 8절. 움직이는 3D 캐릭터를 적용할 때 이 폴더에 GLB(가능하면 Draco/meshopt 압축, KTX2 텍스처)를 둔다.

- 상태 애니메이션 클립 이름은 `CharacterState` enum 값과 같게 만든다: `IDLE`, `CONNECTING`, `GREETING`, `LISTENING`, `THINKING`, `SPEAKING`, `WAITING_APPROVAL`, `RESERVING`, `DONE`, `RETRYING`, `ERROR`.
- 렌더러는 `apps/web/src/features/voice-call/CallCharacter.tsx`의 레지스트리에 `React.lazy`로 등록하고 `VITE_CHARACTER_RENDERER=3d`로 선택한다. props는 `CharacterRendererProps`(`state`, `progress`, `reducedMotion`).
- 이 폴더의 파일은 PWA precache에서 빠지고 첫 사용 때 `call-character-models` 캐시에 저장된다.
- `prefers-reduced-motion`이면 정지 포즈만 보여 준다.
