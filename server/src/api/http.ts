import Fastify, { type FastifyInstance } from 'fastify';
import type { DisplaysRepo } from '../store/displays.js';
import type { SettingsRepo } from '../store/settings.js';
import type { ScenesRepo } from '../store/scenes.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
import { registerSceneRoutes } from './scenes.js';
import { registerTransitionRoutes } from './transitions.js';
import { registerHaEntityRoutes } from './ha-entities.js';
import { registerMoodRoutes } from './moods.js';

export type SafeArea = { top: number; right: number; bottom: number; left: number };
export const DEFAULT_SAFE_AREA: SafeArea = { top: 16, right: 16, bottom: 16, left: 16 };

export function readSafeArea(settings: SettingsRepo): SafeArea {
  const raw = settings.get('safe_area_padding');
  if (!raw) return DEFAULT_SAFE_AREA;
  try {
    const v = JSON.parse(raw) as Partial<SafeArea>;
    return {
      top: Number(v.top ?? DEFAULT_SAFE_AREA.top),
      right: Number(v.right ?? DEFAULT_SAFE_AREA.right),
      bottom: Number(v.bottom ?? DEFAULT_SAFE_AREA.bottom),
      left: Number(v.left ?? DEFAULT_SAFE_AREA.left),
    };
  } catch {
    return DEFAULT_SAFE_AREA;
  }
}

export type HttpDeps = {
  displays: DisplaysRepo;
  settings: SettingsRepo;
  scenes: ScenesRepo;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  haClient?: import('../ha/types.js').HaClient | null;
  onSceneChanged?: (displayId: string, opts?: { explicitTransitionId?: string | null }) => void;
  onSettingsChanged?: () => void;
  onRotationChanged?: (displayId: string) => void;
  onDisplayConfigChanged?: (displayId: string) => void;
};

export async function buildHttpApp(deps: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.post<{ Body: { name?: unknown } }>('/api/displays/register', async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return reply.code(400).send({ error: 'name is required' });
    return deps.displays.registerByName(name);
  });

  app.get('/api/displays', async () => deps.displays.list());

  app.get('/api/settings/safe-area', async () => readSafeArea(deps.settings));
  app.put<{ Body: Partial<SafeArea> }>('/api/settings/safe-area', async (req, reply) => {
    const merged: SafeArea = { ...readSafeArea(deps.settings), ...req.body };
    if (Object.values(merged).some((n) => typeof n !== 'number' || Number.isNaN(n) || n < 0)) {
      return reply.code(400).send({ error: 'invalid safe-area values' });
    }
    deps.settings.set('safe_area_padding', JSON.stringify(merged));
    deps.onSettingsChanged?.();
    return merged;
  });

  registerTransitionRoutes(app, deps.transitions);

  registerHaEntityRoutes(app, { haClient: deps.haClient ?? null });
  registerMoodRoutes(app);

  registerSceneRoutes(app, {
    scenes: deps.scenes,
    displays: deps.displays,
    transitions: deps.transitions,
    onSceneChanged: deps.onSceneChanged,
    onRotationChanged: deps.onRotationChanged,
    onDisplayConfigChanged: deps.onDisplayConfigChanged,
  });

  return app;
}
