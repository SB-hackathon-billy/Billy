/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Call-screen character renderer key ('2d' default; '3d' once the animated model lands). */
  readonly VITE_CHARACTER_RENDERER?: string;
}
