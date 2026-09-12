import { describe, it, expect } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { APPLE_ROOT_CA_PEM } from '../src/aerials/appleRootCa.js';
import { createHttpsFetch } from '../src/aerials/fetch.js';

describe('Apple root certificate', () => {
  it('is the genuine Apple Root CA and has not expired', () => {
    const cert = new X509Certificate(APPLE_ROOT_CA_PEM);
    expect(cert.subject).toContain('CN=Apple Root CA');
    expect(cert.fingerprint256.replace(/:/g, '')).toBe('B0B1730ECBC7FF4505142C49F1295E6EDA6BCAED7E2C68C5BE91B5A11001F024');
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('createHttpsFetch', () => {
  it('rejects with a fetch-shaped TypeError on connection failure', async () => {
    const f = createHttpsFetch([]);
    // Port 9 is discard; nothing listens on it on a dev box, and the
    // point is only that the failure surfaces like fetch's would.
    await expect(f('https://127.0.0.1:9/')).rejects.toThrow(/fetch failed/);
  });
});
