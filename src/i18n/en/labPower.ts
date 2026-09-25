import type { Dict } from "..";

export const labPower: Dict["labPower"] = {
  title: "Lab shutdown / startup",
  subtitle: "Shut everything down or bring it all back up in the right order: the firewall last on shutdown, first on startup",
  shutdownAll: "Full shutdown",
  startupAll: "Full startup",
  simulate: "Simulate",
  simulateHint: "“Simulate” only reads the current state (Proxmox API, ping) and shows what would be done — nothing is run.",
  actions: {
    shutdownServer: "SSH shutdown of {server}",
    wakeServer: "Wake-on-LAN of {server}, then wait for ping",
    shutdownGuests: "Clean shutdown of {guests}",
    startGuests: "Start {guests}",
  },
  executeTitle: "Real run",
  executeHint: "To really run the sequence, type",
  confirmAria: "Confirmation phrase",
  cancelAfterStep: "Cancel after the current step",
  execute: "Run",
};
