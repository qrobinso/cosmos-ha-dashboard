import type { OverlayMessage } from '../overlay/types.js';

/** Targeted display from a topic — `'all'` means broadcast. */
export type CommandTarget = string | 'all';

export type ShowMessageCommand = { kind: 'show_message'; target: CommandTarget; message: OverlayMessage };
export type DismissMessageCommand = { kind: 'dismiss_message'; target: CommandTarget };
export type ShowSceneCommand = { kind: 'show_scene'; target: CommandTarget; sceneName: string };
export type LastSceneCommand = { kind: 'last_scene'; target: CommandTarget };
/** Server-side `scene/alert` command. `sceneName` may be empty — the
 *  dispatcher falls back to the per-display picked alert scene set via
 *  the select entity (`alert/scene/set`). Notify's Message field maps to
 *  `sceneName`; Title maps to `dwellMs`. */
export type ShowSceneAlertCommand = {
  kind: 'show_scene_alert';
  target: CommandTarget;
  sceneName: string;
  dwellMs: number;
  transitionId?: string;
};
/** HA writes the picked scene name to `alert/scene/set` (from the select
 *  entity's `command_topic`); the server persists it per-display and
 *  republishes on `alert/scene` (retained) so the select renders the
 *  current value across restarts. */
export type SetAlertSceneCommand = { kind: 'set_alert_scene'; target: CommandTarget; sceneName: string };

export type ParsedCommand =
  | ShowMessageCommand
  | DismissMessageCommand
  | ShowSceneCommand
  | LastSceneCommand
  | ShowSceneAlertCommand
  | SetAlertSceneCommand;

export type MqttClient = {
  /** Publish a JSON payload (will be JSON.stringified) to a topic, with optional retain. */
  publish(topic: string, payload: object | string, opts?: { retain?: boolean }): void;
  /** Subscribe to a topic; the handler receives raw payload bytes as a string. */
  subscribe(topic: string, handler: (topic: string, payload: string) => void): void;
  close(): Promise<void>;
};
