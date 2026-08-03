import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api';

describe('admin api — voice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setVoice PUTs to /api/displays/:name/voice', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    await api.displays.setVoice('kitchen', { enabled: true, pipelineId: 'p1' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/displays/kitchen/voice',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: true, pipelineId: 'p1' }) })
    );
  });

  it('listAssistPipelines GETs /api/ha/assist-pipelines', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'p1', name: 'Home' }] });
    vi.stubGlobal('fetch', fetchMock);
    const pipelines = await api.ha.listAssistPipelines();
    expect(pipelines).toEqual([{ id: 'p1', name: 'Home' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/ha/assist-pipelines');
  });

  it('listAssistPipelines falls back to [] when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'nope' }) });
    vi.stubGlobal('fetch', fetchMock);
    const pipelines = await api.ha.listAssistPipelines();
    expect(pipelines).toEqual([]);
  });
});
