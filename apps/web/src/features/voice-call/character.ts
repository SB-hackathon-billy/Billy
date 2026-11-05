// 통화 캐릭터 상태. 화면은 이 enum만 렌더러에 넘기므로 2D 일러스트를 3D 모델로 바꿔도 로직이 그대로다.
import type { ComponentType } from 'react';
import type { VoiceStatus } from '@sb/contracts';

export const CharacterState = {
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  GREETING: 'GREETING',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  RESERVING: 'RESERVING',
  DONE: 'DONE',
  RETRYING: 'RETRYING',
  ERROR: 'ERROR',
} as const;
export type CharacterState = (typeof CharacterState)[keyof typeof CharacterState];

export type ApprovalPhase = 'collecting' | 'review' | 'reserving' | 'done' | 'retrying';

export interface CharacterInput {
  voice: VoiceStatus;
  phase: ApprovalPhase;
  /** An extraction for the latest utterance is queued/running. */
  thinking: boolean;
  userSpoke: boolean;
}

/** Pure mapping from what the call recorded to the character's state. Order = priority. */
export function deriveCharacterState(input: CharacterInput): CharacterState {
  if (input.phase === 'reserving') return CharacterState.RESERVING;
  if (input.phase === 'done') return CharacterState.DONE;
  if (input.phase === 'retrying') return CharacterState.RETRYING;
  if (input.phase === 'review') return CharacterState.WAITING_APPROVAL;
  switch (input.voice) {
    case 'IDLE':
    case 'CLOSED':
      return CharacterState.IDLE;
    case 'CONNECTING':
      return CharacterState.CONNECTING;
    case 'ERROR':
    case 'RECONNECT_REQUIRED':
      return CharacterState.ERROR;
    case 'SPEAKING':
      return input.userSpoke ? CharacterState.SPEAKING : CharacterState.GREETING;
    case 'LISTENING':
      return input.thinking ? CharacterState.THINKING : CharacterState.LISTENING;
  }
}

/**
 * Renderer seam for the planned animated 3D character. A 3D renderer (e.g. react-three-fiber with a
 * GLB from /models/character/) implements the same props and is registered lazily, so the call
 * screen and its state logic stay unchanged.
 */
export interface CharacterRendererProps {
  state: CharacterState;
  /** 0..1 share of required intake items already collected. */
  progress: number;
  reducedMotion: boolean;
}
export type CharacterRenderer = ComponentType<CharacterRendererProps>;
