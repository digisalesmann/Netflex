import type { NetflexEnvironment } from '@netflex/config';
import type { Gateway } from '@netflex/database';
import { FakeNetworkAdapter, type NetworkAdapter } from '@netflex/network';
import type { AdapterRegistry } from './network.js';

/**
 * Maps registered gateways to adapters. Today only the TEST-ONLY fake exists
 * (NETWORK_ADAPTER=fake in development/test). Real vendors return null and their
 * operations fail with ADAPTER_NOT_IMPLEMENTED until a hardware-verified adapter
 * is added (spec §11: never pretend).
 */
export class DefaultAdapterRegistry implements AdapterRegistry {
  readonly fake: FakeNetworkAdapter | null;

  constructor(mode: 'none' | 'fake' | 'mikrotik', env: NetflexEnvironment) {
    this.fake = mode === 'fake' ? new FakeNetworkAdapter(env) : null;
  }

  forGateway(gateway: Gateway): NetworkAdapter | null {
    if (gateway.vendor === 'FAKE') return this.fake;
    return null;
  }
}
