import { describe, it, expect, vi } from 'vitest';
import { startVoiceAssistant } from './index';
import type { CosmosConnection, ServerMessage } from '../ws';

describe('startVoiceAssistant', () => {
  it('drives overlay state through listening -> thinking -> response on voice_result events', () => {
    let messageHandler: ((msg: ServerMessage) => void) | null = null;
    const sendVoiceAudio = vi.fn();
    const connection: CosmosConnection = {
      close: vi.fn(),
      sendVoiceAudio,
      sendVoiceHealth: vi.fn(),
    };
    const states: [string, string | undefined][] = [];
    const playAudio = vi.fn();

    const handle = startVoiceAssistant(connection, (state, text) => states.push([state, text]), {
      onServerMessage: (fn) => {
        messageHandler = fn;
      },
      playAudio,
    });

    messageHandler?.({ type: 'voice_result', stage: 'stt-end', text: 'turn on the lights' });
    messageHandler?.({ type: 'voice_result', stage: 'intent-end', text: 'Turning on the lights' });
    messageHandler?.({ type: 'voice_result', stage: 'tts-end', audioUrl: '/api/tts/abc.mp3' });

    expect(states).toEqual([
      ['thinking', 'turn on the lights'],
      ['thinking', 'Turning on the lights'],
      ['response', 'Turning on the lights'],
    ]);
    expect(playAudio).toHaveBeenCalledWith('/api/tts/abc.mp3');

    handle.stop();
  });

  it('surfaces an error voice_result as the error overlay state', () => {
    let messageHandler: ((msg: ServerMessage) => void) | null = null;
    const connection: CosmosConnection = { close: vi.fn(), sendVoiceAudio: vi.fn(), sendVoiceHealth: vi.fn() };
    const states: [string, string | undefined][] = [];

    const handle = startVoiceAssistant(connection, (state, text) => states.push([state, text]), {
      onServerMessage: (fn) => {
        messageHandler = fn;
      },
      playAudio: vi.fn(),
    });

    messageHandler?.({ type: 'voice_result', stage: 'error', error: 'HA unreachable' });
    expect(states).toEqual([['error', 'HA unreachable']]);
    handle.stop();
  });

  it('does not echo stale text on a post-error tts-end with no text of its own', () => {
    let messageHandler: ((msg: ServerMessage) => void) | null = null;
    const connection: CosmosConnection = { close: vi.fn(), sendVoiceAudio: vi.fn(), sendVoiceHealth: vi.fn() };
    const states: [string, string | undefined][] = [];
    const playAudio = vi.fn();

    const handle = startVoiceAssistant(connection, (state, text) => states.push([state, text]), {
      onServerMessage: (fn) => {
        messageHandler = fn;
      },
      playAudio,
    });

    messageHandler?.({ type: 'voice_result', stage: 'stt-end', text: "what's the weather" });
    messageHandler?.({ type: 'voice_result', stage: 'error', error: 'HA unreachable' });
    messageHandler?.({ type: 'voice_result', stage: 'tts-end', audioUrl: '/api/tts/fallback.mp3' });

    expect(states).toEqual([
      ['thinking', "what's the weather"],
      ['error', 'HA unreachable'],
      ['response', undefined],
    ]);
    expect(playAudio).toHaveBeenCalledWith('/api/tts/fallback.mp3');

    handle.stop();
  });

  it('resets stale text across a listening -> ... -> listening turn boundary', () => {
    let messageHandler: ((msg: ServerMessage) => void) | null = null;
    const connection: CosmosConnection = { close: vi.fn(), sendVoiceAudio: vi.fn(), sendVoiceHealth: vi.fn() };
    const states: [string, string | undefined][] = [];
    const playAudio = vi.fn();

    const handle = startVoiceAssistant(connection, (state, text) => states.push([state, text]), {
      onServerMessage: (fn) => {
        messageHandler = fn;
      },
      playAudio,
    });

    messageHandler?.({ type: 'voice_result', stage: 'stt-end', text: 'turn on the lights' });
    messageHandler?.({ type: 'voice_result', stage: 'intent-end', text: 'Turning on the lights' });
    messageHandler?.({ type: 'voice_result', stage: 'tts-end', audioUrl: '/api/tts/abc.mp3' });

    // New turn begins; no stt/intent text arrives before tts-end fires.
    messageHandler?.({ type: 'voice_result', stage: 'listening' });
    messageHandler?.({ type: 'voice_result', stage: 'tts-end', audioUrl: '/api/tts/def.mp3' });

    expect(states).toEqual([
      ['thinking', 'turn on the lights'],
      ['thinking', 'Turning on the lights'],
      ['response', 'Turning on the lights'],
      ['listening', undefined],
      ['response', undefined],
    ]);

    handle.stop();
  });
});
