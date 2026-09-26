import type { Dict } from "..";

export const sshAuth: Dict["sshAuth"] = {
  methods: {
    password: "Password",
    passwordHint: "Saved password, encrypted with the master key.",
    key: "App key",
    keyHint: "SSH key managed in Settings → SSH keys (the private key stays encrypted in the app).",
    agent: "SSH agent",
    agentHint: "Keys loaded in the Windows OpenSSH agent (ssh-add) or in Pageant.",
  },
  warnNoKeys: "No SSH key saved: create or import one in Settings → SSH keys.",
  warnChooseKey: "Choose the key to use.",
  warnKeyDeleted: "The chosen key was deleted: choose another one.",
  blockedWindows:
    "Automatic deployment is not possible on Windows: for administrators, OpenSSH reads C:\\ProgramData\\ssh\\administrators_authorized_keys. Copy the public key (Settings → SSH keys) and add it by hand.",
  blockedEsxi:
    "Automatic deployment is not possible on ESXi: keys live in /etc/ssh/keys-<user>/authorized_keys. Add the public key from the ESXi interface.",
  truenasWarning:
    "On TrueNAS, the middleware may regenerate authorized_keys: also add the key under Credentials → Users so that it is kept.",
  summaryKey: "Key “{name}”",
  summaryKeyDeleted: "Deleted key",
  summaryVia: "{text} · via {jump}",
  title: "SSH authentication",
  methodAria: "SSH authentication method",
  appKey: "App key",
  loadingKeys: "Loading keys…",
  chooseKey: "— Choose a key —",
  keyDeleted: "Deleted key",
  clearPassword: "Delete the saved password for this server",
  jumpHost: "Jump host (optional)",
  jumpNone: "None (direct connection)",
  jumpMissing: "Jump host unavailable — change it",
  jumpDependents: "This server is the jump host of {servers}: it cannot use a jump host itself (one level only).",
  jumpHelp: "The connection goes through this server (SSH tunnel); the host key of every hop is checked.",
  checkAgent: "Test the agent",
  agentTesting: "Testing…",
  agentSource: "{source}: {count} key",
  agentSourcePlural: "{source}: {count} keys",
  agentNoKeysInSource: "{source}: reachable, but no key loaded (ssh-add)",
  agentKeys: { one: "{count} key available ({sources}).", other: "{count} keys available ({sources})." },
  agentUnreachable: "No SSH agent reachable.",
  agentInfoLabel: "What is an SSH agent?",
  agentInfo:
    "An SSH agent keeps your decrypted private keys in memory and signs authentications for you: the app never sees or stores the key itself.\n\n" +
    "Windows — OpenSSH agent (PowerShell, as administrator):\n" +
    "  Get-Service ssh-agent | Set-Service -StartupType Automatic\n" +
    "  Start-Service ssh-agent\n" +
    "  ssh-add C:\\path\\to\\your_key\n\n" +
    "Pageant (PuTTY): launch Pageant, then from its notification-area icon → Add Key, choose your .ppk key (or convert an OpenSSH key with PuTTYgen).\n\n" +
    "Which to choose?\n" +
    "• SSH agent: handy if you already run an agent with your keys (shared with other tools like Git or WinSCP); the app stores nothing.\n" +
    "• App key: the key is encrypted with the master key and managed here (Settings → SSH keys) — simplest if you don't already have an agent.\n" +
    "• Password: the quickest to set up, but the least secure (replayable, depends on the server's policy).",
  deploy: {
    via: {
      password: "the saved password",
      key: "the current app key",
      agent: "the SSH agent",
    },
    title: "Deploy a key on {name}",
    close: "Close",
    runningTitle: "Deploying on {name}",
    running: "Adding the key, then checking key-based login…",
    wait: "Please wait…",
    added: "The key was added",
    alreadyPresent: "The key was already there",
    doneTitle: "Key deployed",
    doneMessage: "{added} and key-based login works.",
    verified: "Key-based login verified",
    switchTitle: "Use the key for {name}?",
    switchMessage:
      "{added} in ~/.ssh/authorized_keys of {target} and key-based login works.\n\nSwitch {name} to the key “{key}” for every connection made by the app?",
    useKey: "Use the key",
    keepMethod: "Keep the current method",
    deployedOn: "Key deployed on {name}",
    switched: "{name} now uses the key “{key}”",
    failedTitle: "Key-based login refused",
    failedMessage:
      "{added}, but key-based login failed: {detail}.\n\nCheck the permissions of ~/.ssh (700) and authorized_keys (600), and that PubkeyAuthentication is enabled in sshd. The server keeps its current method.",
    unknownReason: "unknown reason",
    noKeys: "No SSH key saved: generate or import one in Settings → SSH keys.",
    explain:
      "The chosen public key will be added to ~/.ssh/authorized_keys of {target}, connecting with {via}{jump}.\n~/.ssh (700) and authorized_keys (600) are created if missing; the line is never added twice. Key-based login is then verified.",
    viaJump: " (through the jump host)",
    confirm: "Deploy the key",
    keyToDeploy: "Key to deploy",
  },
};
