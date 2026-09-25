import { NetworkDevice, Server } from "../types";

/**
 * Serveurs sans MAC pour lesquels le scan en a trouvé une utilisable
 * (les cartes virtuelles sont exclues : le WoL ne démarre pas une VM).
 */
export function missingMacFixes(servers: Server[], devices: NetworkDevice[]): { server: Server; mac: string }[] {
  return servers
    .filter((s) => !s.mac_address)
    .map((s) => ({ server: s, device: devices.find((d) => d.ip === s.ip) }))
    .filter((x): x is { server: Server; device: NetworkDevice } => !!x.device?.mac && !x.device.virtual_nic)
    .map(({ server, device }) => ({ server, mac: device.mac! }));
}
