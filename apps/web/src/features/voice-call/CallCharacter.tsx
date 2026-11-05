import { Suspense, lazy, useEffect, useState } from 'react';
import { Character2D } from './Character2D.js';
import type { CharacterRenderer, CharacterRendererProps } from './character.js';

/**
 * Renderer registry. When the animated 3D character is ready, add e.g.
 *   '3d': lazy(() => import('./Character3D.js').then((m) => ({ default: m.Character3D })))
 * and select it with VITE_CHARACTER_RENDERER=3d. The GLB goes in public/models/character/.
 */
const renderers: Record<string, CharacterRenderer | ReturnType<typeof lazy<CharacterRenderer>>> = {
  '2d': Character2D,
};
const selected = renderers[import.meta.env.VITE_CHARACTER_RENDERER ?? '2d'] ?? Character2D;

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
  const Renderer = selected;
  return (
    <div className="vc-character-slot">
      {/* The enum value itself, as requested, so the state machine is visible while the art evolves. */}
      <p className="vc-state" role="status" aria-label={`캐릭터 상태 ${props.state}`}>
        {props.state}
      </p>
      <Suspense fallback={<Character2D {...props} reducedMotion={reducedMotion} />}>
        <Renderer {...props} reducedMotion={reducedMotion} />
      </Suspense>
    </div>
  );
}
