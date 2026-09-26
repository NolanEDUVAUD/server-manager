import type { Dict } from "..";

export const appUpdate: Dict["appUpdate"] = {
  notConfigured: "Automatic updates are not configured for this build",
  banner: {
    label: "Update available",
    installed: "installed: {version}",
    published: "released on {date}",
    notes: "Release notes",
    retry: "Retry installation",
    later: "Later",
  },
  available: "Version {version} available",
  install: "Install and restart",
  confirmTitle: "Install version {version}?",
  confirmMessage:
    "Version {version} will be downloaded from GitHub, then its signature will be checked against the public key built into the application: an unsigned or modified package is rejected.\n\nIf the signature is valid, the installer will replace the application and restart it automatically. Your servers and configuration are kept.\n\nTasks running in the application (SSH consoles, batch tasks, lab shutdown or startup…) will be interrupted.",
  progress: {
    preparing: "Preparing download…",
    downloadingPercent: "Downloading… {percent} %",
    downloadingBytes: "Downloading… {size}",
    verifying: "Checking signature…",
    installing: "Installing… the application will restart",
  },
  settings: {
    title: "Application updates",
    installedVersion: "Installed version",
    checkOnStartup: "Check for updates at startup",
    checkOnStartupHelp: "Nothing is installed without your confirmation; every version is signed and verified before installation.",
    checkNow: "Check now",
    checking: "Checking…",
    upToDate: "The application is up to date",
    upToDateVersion: "The application is up to date (version {version})",
    showBanner: "Show the banner",
    seeBanner: ": see the banner at the top of the window",
    checkFailed: "Check failed",
    releaseNotes: "Release notes",
    viewReleases: "View releases on GitHub",
  },
};
