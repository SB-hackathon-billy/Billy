// 통화 캐릭터 3D 렌더러. 명세: docs/specs/0003-voice-call-reservation.md 8절
// GLB의 애니메이션 클립 이름이 CharacterState 값과 같다. 모델을 받기 전이나 WebGL을 쓸 수 없으면 2D 캐릭터를 보여 준다.
// 발이 없는 캐릭터라 렌더러가 클립과 별도로 계속 떠다니는 움직임과 바닥 그림자를 더한다.
import { useEffect, useRef, useState } from 'react';
import {
  AnimationMixer,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  type AnimationAction,
  type AnimationClip,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Character2D } from './Character2D.js';
import { CharacterState, type CharacterRendererProps } from './character.js';

/**
 * Versioned file name: public/ files are served without a content hash and the service worker keeps
 * /models/character/ for 30 days, so a changed model must ship under a new name.
 */
export const CHARACTER_MODEL_URL = '/models/character/billy-mascot-v2.glb';
const PLAY_ONCE: ReadonlySet<CharacterState> = new Set([
  CharacterState.GREETING,
  CharacterState.DONE,
  CharacterState.ERROR,
]);
const FADE_SECONDS = 0.25;
/**
 * Hover applied on top of every clip, so the character never looks parked even after a play-once
 * clip settles. Bob, sway and turn use unrelated periods so the combined drift doesn't visibly repeat.
 * Units are model units (the body is 1.0 wide); the pivot sits mid-body so sway doesn't swing the top.
 */
const HOVER = {
  lift: 0.08,
  pivot: 0.45,
  bob: 0.045,
  bobSeconds: 3.2,
  swayRadians: (2.2 * Math.PI) / 180,
  swaySeconds: 4.7,
  turnRadians: (3 * Math.PI) / 180,
  turnSeconds: 6.3,
};

/** Soft contact shadow on the floor; it shrinks and fades as the character rises. */
function createShadow(): { mesh: Mesh; material: MeshBasicMaterial; dispose(): void } {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, 'rgba(32, 54, 74, 0.34)');
    gradient.addColorStop(0.55, 'rgba(32, 54, 74, 0.16)');
    gradient.addColorStop(1, 'rgba(32, 54, 74, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const geometry = new PlaneGeometry(0.95, 0.95);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return {
    mesh,
    material,
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

let modelRequest: Promise<GLTF> | null = null;
function loadModel(): Promise<GLTF> {
  modelRequest ??= new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(CHARACTER_MODEL_URL)
    .catch((error: unknown) => {
      modelRequest = null; // a later call screen retries instead of reusing the failure
      throw error;
    });
  return modelRequest;
}

interface Stage {
  play(state: CharacterState, reducedMotion: boolean): void;
  dispose(): void;
}

function createStage(canvas: HTMLCanvasElement, gltf: GLTF, onLost: () => void): Stage {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  // Same framing as the Stage camera in assets-src/character/billy-mascot.blend (70 mm, front view,
  // Y-up here); the headroom above the model is for the hover lift.
  const camera = new PerspectiveCamera(28.8, 1, 0.1, 20);
  camera.position.set(0, 0.84, 3.3);
  camera.lookAt(0.05, 0.56, 0);
  scene.add(new HemisphereLight(0xffffff, 0xd9cfc4, 2.2));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(-2.2, 3.0, 2.6);
  const rim = new DirectionalLight(0xffffff, 1.2);
  rim.position.set(1.2, 2.6, -2.6);
  const pivot = new Group();
  pivot.position.y = -HOVER.pivot;
  pivot.add(gltf.scene);
  const float = new Group();
  float.add(pivot);
  const shadow = createShadow();
  scene.add(key, rim, shadow.mesh, float);

  const hover = (seconds: number) => {
    const rise = Math.sin((seconds / HOVER.bobSeconds) * Math.PI * 2);
    float.position.y = HOVER.pivot + HOVER.lift + HOVER.bob * rise;
    float.rotation.z =
      HOVER.swayRadians * Math.sin((seconds / HOVER.swaySeconds) * Math.PI * 2 + 1.3);
    float.rotation.y = HOVER.turnRadians * Math.sin((seconds / HOVER.turnSeconds) * Math.PI * 2);
    shadow.mesh.scale.setScalar(1 - 0.14 * rise);
    shadow.material.opacity = 0.85 - 0.2 * rise;
  };
  hover(0);

  const mixer = new AnimationMixer(gltf.scene);
  const clips = new Map<string, AnimationClip>(gltf.animations.map((clip) => [clip.name, clip]));
  let current: AnimationAction | null = null;
  let frame = 0;
  let last = 0;

  const render = () => renderer.render(scene, camera);
  const tick = (now: number) => {
    mixer.update(last ? (now - last) / 1000 : 0);
    last = now;
    hover(now / 1000);
    render();
    frame = requestAnimationFrame(tick);
  };
  const stopLoop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!frame) render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const lost = (event: Event) => {
    event.preventDefault();
    stopLoop();
    onLost();
  };
  canvas.addEventListener('webglcontextlost', lost);
  resize();

  return {
    play(state, reducedMotion) {
      const clip = clips.get(state);
      if (!clip) return;
      const next = mixer.clipAction(clip);
      next.setLoop(PLAY_ONCE.has(state) ? LoopOnce : LoopRepeat, Infinity);
      next.clampWhenFinished = true;
      if (reducedMotion) {
        // Still pose, no fades and no render loop: the first frame of a looping state, the settled
        // last frame of a play-once state (its first frame is the pop-in start), hover at rest.
        stopLoop();
        mixer.stopAllAction();
        next.reset().play();
        if (PLAY_ONCE.has(state)) next.time = clip.duration;
        mixer.update(0);
        hover(0);
        current = next;
        render();
        return;
      }
      if (next !== current) {
        next.reset().play();
        if (current) next.crossFadeFrom(current, FADE_SECONDS, false);
        current = next;
      } else if (!next.isRunning()) {
        next.reset().play();
      }
      if (!frame) frame = requestAnimationFrame(tick);
    },
    dispose() {
      stopLoop();
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', lost);
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      pivot.remove(gltf.scene);
      shadow.dispose();
      // The parsed model is cached for the next call screen; release only its GPU resources so this
      // renderer's dispose listeners and programs are not kept alive by the shared geometry/materials.
      gltf.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        for (const material of [object.material].flat()) material.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss(); // browsers cap live contexts; don't wait for GC between call screens
    },
  };
}

export function Character3D(props: CharacterRendererProps) {
  const { state, reducedMotion } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    loadModel()
      .then((gltf) => {
        if (disposed) return;
        stageRef.current = createStage(canvas, gltf, () => setStatus('failed'));
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('failed');
      });
    return () => {
      disposed = true;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status === 'ready') stageRef.current?.play(state, reducedMotion);
  }, [status, state, reducedMotion]);

  return (
    <div className="vc-character-3d" data-ready={status === 'ready' || undefined}>
      {status !== 'failed' && <canvas ref={canvasRef} aria-hidden="true" />}
      {status !== 'ready' && <Character2D {...props} />}
    </div>
  );
}
