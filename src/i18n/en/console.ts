import type { Dict } from "..";

export const consolePage: Dict["console"] = {
  title: "Console",
  subtitle: "SSH terminal using the credentials saved for each server",
  pickServer: "Choose a server to open a session:",
  noServers: "No servers configured.",
  closeSession: "Close session",
  newSession: "New session",
  reconnect: "Reconnect",
  connecting: "Connecting to {title}…",
  snippets: {
    button: "Commands",
    insertHint: "Insert a saved command (without running it)",
    needSession: "Open a session to use commands",
    namePlaceholder: "Name",
    nameLabel: "Command name",
    commandPlaceholder: "command",
    commandLabel: "Command",
  },
};
