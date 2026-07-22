import type { CosmosConnection, ServerMessage } from '../ws';
import type { VoiceOverlayState } from './types';

export type VoiceAssistantDeps = {
  /** Registers a callback for inbound server messages; returns nothing, callback fires per message. */
  onServerMessage: (fn: (msg: ServerMessage) => void) => void;
  /** Plays a TTS response through the kiosk's speakers. Defaults to a real <audio> element. */
  playAudio?: (url: string) => void;
};

export type VoiceAssistantHandle = {
  stop(): void;
};

function defaultPlayAudio(url: string): void {
  const audio = new Audio(url);
  void audio.play();
}

export function startVoiceAssistant(
  connection: CosmosConnection,
  onOverlayState: (state: VoiceOverlayState, text?: string) => void,
  deps: VoiceAssistantDeps
): VoiceAssistantHandle {
  const playAudio = deps.playAudio ?? defaultPlayAudio;

  // Carries the last known utterance/intent text forward so the 'response'
  // overlay state has something to display even when the tts-end message
  // itself only carries an audioUrl (the server's tts-end payload doesn't
  // repeat the text already sent at stt-end/intent-end).
  let lastText: string | undefined;

  deps.onServerMessage((msg) => {
    if (msg.type !== 'voice_result') return;
    switch (msg.stage) {
      case 'listening':
        onOverlayState('listening');
        break;
      case 'stt-end':
      case 'intent-end':
        lastText = msg.text;
        onOverlayState('thinking', msg.text);
        break;
      case 'tts-end':
        onOverlayState('response', msg.text ?? lastText);
        if (msg.audioUrl) playAudio(msg.audioUrl);
        break;
      case 'error':
        onOverlayState('error', msg.error);
        break;
    }
  });

  return {
    stop() {
      connection.sendVoiceHealth('idle');
    },
  };
}
