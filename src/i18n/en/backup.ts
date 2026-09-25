import type { Dict } from "..";

export const backup: Dict["backup"] = {
  title: "Encrypted backup",
  intro:
    "Contains the whole configuration, passwords and tokens included, encrypted with a passphrase. Use it to get everything back on another PC. Without the passphrase the backup cannot be read: nobody can recover it.",
  passphrase: "Passphrase",
  passphraseConfirm: "Confirm the passphrase",
  passphraseHint: "At least {min} characters. A phrase made of several words is safer and easier to remember.",
  tooShort: "Passphrase too short (at least {min} characters)",
  mismatch: "The two passphrases do not match",
  export: {
    button: "Export an encrypted backup…",
    running: "Encrypting…",
    done: "Backup saved: {path}",
  },
  restore: {
    title: "Restore a backup",
    choose: "Choose a backup…",
    reading: "Decrypting…",
    summaryTitle: "Backup from {date} (version {version})",
    summary:
      "{servers} server(s), {groups} group(s), {probes} service(s), {proxmox} Proxmox connection(s), {integrations} integration(s), {schedules} scheduled task(s)",
    apply: "Restore",
    confirmTitle: "Replace the whole configuration",
    confirmMessage:
      "The whole current configuration (servers, groups, services, integrations, tasks, settings) will be replaced by the backup. A copy of the current configuration is kept next to the data (data.json.before-restore.bak). This PC's lock and automatic backup settings do not change. Continue?",
    done: "Configuration restored",
  },
  auto: {
    title: "Automatic backup",
    enable: "Enable automatic backup",
    enableHelp: "Writes an encrypted backup to a folder (external drive, mounted NAS…) and keeps only the most recent ones.",
    folder: "Destination folder",
    browse: "Browse…",
    frequency: "Frequency",
    daily: "Every day",
    weekly: "Every week",
    keep: "Number of backups kept",
    passphraseStored: "Passphrase saved: leave empty to keep it",
    lockedNote: "No automatic backup is made while the application is locked.",
    save: "Save",
    saved: "Automatic backup saved",
    runNow: "Back up now",
    running: "Backing up…",
    ran: "Backup written: {path}",
    lastRun: "Last backup: {date}",
    never: "No automatic backup yet",
    lastError: "Last failure: {message}",
  },
};
