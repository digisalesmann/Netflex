import { describe, expect, it } from 'vitest';
import { TEST_UNAUTH_PATH, fakeController } from './fake-controller.mjs';
import { createOmada, toCanonicalMac, toOmadaMac, versionAtLeast } from './omada.mjs';

const base = {
  url: 'https://127.0.0.1:8043',
  operator: { name: 'netflex-link', password: 'op-pass' },
};
const client = {
  mac: 'aa:bb:cc:00:00:01',
  apMac: '50:c7:bf:00:00:aa',
  ssidName: 'ND Lodge Wi-Fi',
  radioId: 1,
  site: 'ND Lodge',
};

describe('Omada controller client', () => {
  it('converts MAC formats both ways and compares versions', () => {
    expect(toOmadaMac('aa:bb:cc:00:00:01')).toBe('AA-BB-CC-00-00-01');
    expect(toCanonicalMac('AA-BB-CC-00-00-01')).toBe('aa:bb:cc:00:00:01');
    expect(versionAtLeast('6.2.10.4', '6.2.10')).toBe(true);
    expect(versionAtLeast('5.15.8', '6.2.10')).toBe(false);
  });

  it('signs in as the hotspot operator and switches a device on with the plan time', async () => {
    const c = fakeController({ version: '5.15.8' });
    const o = createOmada(base, { request: c.request });
    expect(await o.health()).toMatchObject({ reachable: true, version: '5.15.8' });
    const until = Date.now() + 3_600_000;
    expect(await o.authorize({ clients: [client], untilMs: until })).toEqual({
      authorized: [client.mac],
      failed: [],
    });
    const a = c.state.authorized.get('AA-BB-CC-00-00-01');
    expect(a).toMatchObject({
      apMac: '50-C7-BF-00-00-AA',
      ssidName: 'ND Lodge Wi-Fi',
      radioId: '1',
      authType: '4',
    });
    // Controllers before 6.2.10 take microseconds.
    expect(Number(a.time)).toBeGreaterThan(3_590_000_000);
    expect(Number(a.time)).toBeLessThanOrEqual(3_600_000_000);
  });

  it('uses milliseconds on 6.2.10 and later', async () => {
    const c = fakeController({ version: '6.2.10' });
    const o = createOmada(base, { request: c.request });
    await o.health();
    await o.authorize({ clients: [client], untilMs: Date.now() + 3_600_000 });
    expect(Number(c.state.authorized.get('AA-BB-CC-00-00-01').time)).toBeLessThanOrEqual(3_600_000);
  });

  it('signs in again when the session has expired, and reports refused devices', async () => {
    const c = fakeController();
    const o = createOmada(base, { request: c.request });
    await o.authorize({ clients: [client], untilMs: Date.now() + 60_000 });
    c.state.sessions.clear(); // controller restarted
    c.state.refuse.add('AA-BB-CC-00-00-02');
    const r = await o.authorize({
      clients: [client, { ...client, mac: 'aa:bb:cc:00:00:02' }],
      untilMs: Date.now() + 60_000,
    });
    expect(r.authorized).toEqual([client.mac]);
    expect(r.failed[0]).toMatchObject({ mac: 'aa:bb:cc:00:00:02' });
  });

  it('says honestly what it cannot do without the Open API', async () => {
    const o = createOmada(base, { request: fakeController().request });
    expect(o.features()).toEqual({ unauthorize: false, listClients: false });
    expect(await o.unauthorize({ macs: [client.mac], site: client.site })).toEqual({
      unsupported: true,
    });
    expect(await o.findClient({ mac: client.mac, site: client.site })).toEqual({
      unsupported: true,
    });
  });

  it('with the Open API: finds connected devices and switches them off early', async () => {
    const c = fakeController();
    const o = createOmada(
      {
        ...base,
        openApi: { clientId: 'id', clientSecret: 'secret' },
        paths: { openApiUnauthorize: TEST_UNAUTH_PATH },
      },
      { request: c.request },
    );
    expect(o.features()).toEqual({ unauthorize: true, listClients: true });
    c.state.connected.set('AA-BB-CC-00-00-01', '50-C7-BF-00-00-AA');
    expect(await o.findClient({ mac: client.mac, site: client.site })).toEqual({
      connected: true,
      apMac: '50:c7:bf:00:00:aa',
    });
    expect(await o.findClient({ mac: 'aa:bb:cc:00:00:09', site: client.site })).toMatchObject({
      connected: false,
    });
    await o.authorize({ clients: [client], untilMs: Date.now() + 60_000 });
    expect((await o.listClients({ site: client.site })) as unknown).toMatchObject({
      clients: [{ mac: client.mac, authorized: true }],
    });
    expect(await o.unauthorize({ macs: [client.mac], site: client.site })).toEqual({
      done: [client.mac],
      failed: [],
    });
    expect(c.state.authorized.has('AA-BB-CC-00-00-01')).toBe(false);
  });

  it('a controller on another computer needs a pinned certificate', async () => {
    const o = createOmada(
      { ...base, url: 'https://192.168.1.20:8043' },
      { request: fakeController().request },
    );
    expect((await o.health()).detail).toMatch(/fingerprint/);
  });
});
