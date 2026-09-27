import type { Dict } from "..";

export const bugReport: Dict["bugReport"] = {
  title: "Report an issue",
  intro:
    "Describe the problem you ran into: a pre-filled issue will open on GitHub, which you can review and edit before sending it.",
  fields: {
    title: "Title",
    titlePlaceholder: "Short summary of the issue",
    description: "Description",
    descriptionPlaceholder: "What is happening?",
    steps: "Steps to reproduce",
    stepsPlaceholder: "1. …\n2. …\n3. …",
    expected: "Expected behavior",
    actual: "Actual behavior",
  },
  includeSystemInfo: "Include system information",
  includeSystemInfoHelp:
    "App version, operating system, language and enabled modules. Never any IP address, credentials, keys or hostnames.",
  send: "Send on GitHub",
  sendHelp: "Opens a pre-filled issue in your browser: nothing is published without your confirmation on GitHub.",
  copy: "Copy report",
  copied: "Report copied to clipboard",
  openFailed: "Could not open the browser",
  openFailedFallback: "Copy the address below and open it yourself in your browser:",
  copyUrl: "Copy address",
  urlCopied: "Address copied",
  titleRequired: "The title is required",
};
