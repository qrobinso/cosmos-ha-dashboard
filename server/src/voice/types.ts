export type VoiceHealth = 'ok' | 'permission_denied' | 'model_load_failed' | 'idle' | 'error';

export type VoiceResultStage = 'listening' | 'stt-end' | 'intent-end' | 'tts-end' | 'error';

export type VoiceResult = {
  stage: VoiceResultStage;
  text?: string;
  audioUrl?: string;
  error?: string;
};

export type HaAssistPipeline = {
  id: string;
  name: string;
};

export type VoiceHaClient = {
  runPipeline(pipelineId: string | null, audioChunks: AsyncIterable<Uint8Array>): AsyncIterable<VoiceResult>;
  listPipelines(): Promise<HaAssistPipeline[]>;
  close(): void;
};
