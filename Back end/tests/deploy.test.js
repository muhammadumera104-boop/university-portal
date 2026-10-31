import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8'));

describe('Vercel deployment config', () => {
  it('installs the same API dependencies as the Back end package', () => {
    // Vercel installs the root package.json for api/index.js, so it must not drift from Back end/package.json.
    expect(read('package.json').dependencies).toEqual(read('Back end', 'package.json').dependencies);
  });
  it('routes /api to the function and everything else to the single-page app', () => {
    const { rewrites, outputDirectory, functions } = read('vercel.json');
    expect(rewrites[0]).toEqual({ source: '/api/(.*)', destination: '/api' });
    expect(rewrites[1].destination).toBe('/index.html');
    expect(rewrites[1].source).toContain('(?!api/)');
    expect(outputDirectory).toBe('Front end/dist');
    expect(functions['api/index.js'].maxDuration).toBeGreaterThanOrEqual(30);
  });
  it('exposes the Express app from the function entry', () => {
    const entry = fs.readFileSync(path.join(root, 'api', 'index.js'), 'utf8');
    expect(entry).toMatch(/from '\.\.\/Back end\/src\/app\.js'/);
    expect(entry).toMatch(/export default app/);
  });
  it('keeps secrets and local files out of git', () => {
    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/);
    for (const line of ['.env', '.env.*', '.vercel/', 'node_modules/', 'dist/']) expect(ignore).toContain(line);
  });
  it('never puts the service-role key in a browser variable', () => {
    for (const file of ['Front end/.env.example', 'Back end/.env.example']) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      expect(text).not.toMatch(/VITE_[A-Z_]*SERVICE/);
    }
  });
});

describe('upload limit setting', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const limitFor = async (value) => { vi.stubEnv('MAX_UPLOAD_MB', value); vi.resetModules(); return (await import('../src/config.js')).config.maxUploadBytes; };
  it('defaults to 25 MB', async () => expect(await limitFor('')).toBe(25 * 1024 * 1024));
  it('honours a Vercel-safe 4 MB setting', async () => expect(await limitFor('4')).toBe(4 * 1024 * 1024));
  it('never exceeds 25 MB or drops below 1 MB', async () => {
    expect(await limitFor('500')).toBe(25 * 1024 * 1024);
    expect(await limitFor('0.01')).toBe(1024 * 1024);
  });
});
