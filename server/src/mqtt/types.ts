import type { OverlayMessage } from '../overlay/types.js';

/** Targeted display from a topic — `'all'` means broadcast. */
export type CommandTarget = string | 'all';

export type ShowMessageCommand = { kind: 'show_message'; target: CommandTarget; message: OverlayMessage };
export type DismissMessageCommand = { kind: 'dismiss_message'; target: CommandTarget };
export type ShowSceneCommand = { kind: 'show_scene'; target: CommandTarget; sceneName: string };
export type LastSceneCommand = { kind: 'last_scene'; target: CommandTarget };
export type ShowSceneAlertCommand = {
  kind: 'show_scene_alert';
  target: CommandTarget;
  sceneName: string;
  dwellMs: number;
  transitionId?: string;
};

export type ParsedCommand =
  | ShowMessageCommand
  | DismissMessageCommand
  | ShowSceneCommand
  | LastSceneCommand
  | ShowSceneAlertCommand;

export type MqttClient = {
  /** Publish a JSON payload (will be JSON.stringified) to a topic, with optional retain. */
  publish(topic: string, payload: object | string, opts?: { retain?: boolean }): void;
  /** Subscribe to a topic; the handler receives raw payload bytes as a string. */
  subscribe(topic: string, handler: (topic: string, payload: string) => void): void;
  close(): Promise<void>;
};
