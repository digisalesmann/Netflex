/**
 * Lodge link protocol. The link is a small program on the lodge's own computer
 * that talks to the local Wi-Fi controller (Omada) for us. The lodge has no
 * public IP, so the link connects OUT: it checks in over HTTPS, collects
 * instructions, carries them out on the controller, and reports back.
 *
 *   POST /api/v1/link/pair     { code, agentVersion }            -> { token, gatewayId }
 *   POST /api/v1/link/poll     Bearer token, { heartbeat }       -> { commands: LinkCommand[] }
 *   POST /api/v1/link/result   Bearer token, { id, ok, result?, error? }
 *
 * Nothing secret about the controller (address, operator password) ever leaves
 * the lodge computer. Instructions only name devices by MAC address.
 */

export const LINK_PROTOCOL_VERSION = 1;

/** Where Omada says the device is, from its portal redirect. Needed to switch it on. */
export interface OmadaClientContext {
  mac: string;
  apMac: string;
  ssidName: string;
  radioId: number;
  site: string;
}

export type LinkCommandKind = 'authorize' | 'unauthorize' | 'findClient' | 'listClients';

export interface LinkCommandPayloads {
  /** Switch these devices on until `untilMs` (epoch milliseconds). */
  authorize: { clients: OmadaClientContext[]; untilMs: number };
  /** Switch these devices off now. */
  unauthorize: { macs: string[]; site: string };
  /** Is this device connected right now? */
  findClient: { mac: string; site: string };
  /** Who is connected right now? */
  listClients: { site: string };
}

export interface LinkCommandResults {
  authorize: { authorized: string[]; failed: { mac: string; detail: string }[] };
  unauthorize:
    { done: string[]; failed: { mac: string; detail: string }[] } | { unsupported: true };
  findClient: { connected: boolean; apMac: string | null } | { unsupported: true };
  listClients:
    | {
        clients: {
          mac: string;
          ip: string | null;
          apMac: string | null;
          authorized: boolean | null;
          connectedSince: string | null;
        }[];
      }
    | { unsupported: true };
}

export interface LinkCommandWire<K extends LinkCommandKind = LinkCommandKind> {
  id: string;
  kind: K;
  payload: LinkCommandPayloads[K];
}

/** Sent with every check-in. Short, safe strings only: no addresses or credentials. */
export interface LinkHeartbeat {
  agentVersion: string;
  protocol: number;
  controller: {
    reachable: boolean;
    version: string | null;
    /** e.g. "3 access points online" or "operator sign-in failed". */
    detail: string;
  };
  features: {
    /** Can switch a device off before its time is up. */
    unauthorize: boolean;
    /** Can list connected devices (used to confirm a device and to see sessions). */
    listClients: boolean;
  };
}
