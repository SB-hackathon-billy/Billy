import { Suspense, lazy, useEffect, useState } from 'react';
import { Character2D } from './Character2D.js';
import type { CharacterRendererProps } from './character.js';

// three.js is only fetched on the call screen. If the chunk cannot load, the 2D character stays.
const Character3D = lazy(() =>
  import('./Character3D.js').then(
    (module) => ({ default: module.Character3D }),
    () => ({ default: Character2D }),
  ),
);

function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function CallCharacter(props: Omit<CharacterRendererProps, 'reducedMotion'>) {
  const reducedMotion = useReducedMotion();
  return (
    <div className="vc-character-slot">
      {/* The enum value itself, as requested, so the state machine is visible while the art evolves. */}
      <p className="vc-state" role="status" aria-label={`캐릭터 상태 ${props.state}`}>
        {props.state}
      </p>
      {/* 3D 청크를 받는 동안 다른 캐릭터가 잠깐 보이지 않도록 같은 크기의 빈 자리만 둔다. */}
      <Suspense fallback={<div className="vc-character-3d" aria-hidden="true" />}>
        <Character3D {...props} reducedMotion={reducedMotion} />
      </Suspense>
    </div>
  );
}
