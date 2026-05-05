export type TransitionPhase = {
  keyframes: string;
  duration_ms: number;
  easing: string;
  stagger_ms?: number;
};

export type TransitionDescriptor = {
  id: string;
  name: string;
  out: TransitionPhase;
  bridge: { background_morph: boolean; persist_widget_kinds?: string[] };
  in: TransitionPhase;
};

export type StagePhase = 'idle' | 'transitioning';

export type StageState = {
  phase: StagePhase;
  outgoingScene: import('../types').SceneState | null;
  incomingScene: import('../types').SceneState | null;
  transition: TransitionDescriptor | null;
};
