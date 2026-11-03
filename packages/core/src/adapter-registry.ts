import type { NetflexEnvironment } from '@netflex/config';
import type { Gateway, PrismaClient } from '@netflex/database';
import { FakeNetworkAdapter, type NetworkAdapter } from '@netflex/network';
import { LinkBroker, OmadaLinkAdapter } from './lodge-link.js';
import type { AdapterRegistry } from './network.js';

/**
 * Maps registered gateways to adapters:
 * - FAKE: the TEST-ONLY simulator (NETWORK_ADAPTER=fake in development/test).
 * - OMADA: TP-Link Omada through a lodge link (NETWORK_ADAPTER=omada).
 * Other vendors return null and their operations fail with ADAPTER_NOT_IMPLEMENTED
 * (spec §11: never pretend).
 */
export class DefaultAdapterRegistry implements AdapterRegistry {
  readonly fake: FakeNetworkAdapter | null;
  readonly broker: LinkBroker | null;

  constructor(
    private readonly mode: 'none' | 'fake' | 'mikrotik' | 'omada',
    env: NetflexEnvironment,
    private readonly prisma?: PrismaClient,
    brokerOpts?: { timeoutMs?: number; pollMs?: number },
  ) {
    this.fake = mode === 'fake' ? new FakeNetworkAdapter(env) : null;
    this.broker = mode === 'omada' && prisma ? new LinkBroker(prisma, brokerOpts) : null;
  }

  forGateway(gateway: Gateway): NetworkAdapter | null {
    if (gateway.vendor === 'FAKE') return this.fake;
    if (gateway.vendor === 'OMADA' && this.broker && this.prisma)
      return new OmadaLinkAdapter(this.prisma, this.broker, gateway);
    return null;
  }
}
