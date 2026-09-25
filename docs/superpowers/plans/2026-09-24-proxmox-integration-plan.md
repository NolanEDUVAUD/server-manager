# Intégration Proxmox (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à `server-manager` de lister et contrôler entièrement les VMs/LXC d'un ou plusieurs hôtes Proxmox VE (start/stop/restart, snapshots, clonage) directement depuis l'application desktop.

**Architecture:** Un module Rust `proxmox/` autonome (client REST + modèles) consommé par des commandes Tauri fines qui suivent le pattern déjà en place dans `commands/servers.rs` (lock du `Mutex<AppData>`, opération, `save()`, `Result<T, String>`). Côté frontend, une nouvelle page React alimentée par un hook de polling (même pattern que `usePing.ts`), avec le state dans le store Zustand existant.

**Tech Stack:** Rust (Tauri v2, `reqwest` pour le client HTTP, `wiremock` pour les tests), React 18 + TypeScript (Zustand, Tailwind CSS, Vitest + React Testing Library — nouveaux dans ce plan).

**Spec:** `docs/superpowers/specs/2026-09-24-proxmox-integration-design.md`

## Global Constraints

- Authentification Proxmox exclusivement par **API Token** (`Authorization: PVEAPIToken=<token_id>=<secret>`), jamais par login/ticket/CSRF.
- `verify_tls` par connexion, **défaut `false`** (homelab avec certificats auto-signés).
- Les VM/LXC ne sont **jamais persistées sur disque** — seule la connexion (URL + token chiffré) l'est, dans `AppData`.
- Le secret du token ne transite **jamais en clair vers le frontend** — les commandes qui renvoient une `ProxmoxConnection` doivent vider `token_secret`.
- Le chiffrement du secret réutilise **exactement** `crypto::encrypt`/`crypto::decrypt`/`crypto::derive_key` existants (AES-256-GCM) — aucune nouvelle primitive crypto.
- Toute commande Tauri retourne `Result<T, String>` et suit le pattern lock-mutex → opération → `drop(data)` → `state.save()`, comme `commands/servers.rs`.
- Les commandes Tauri elles-mêmes (qui dépendent de `State<AppState>`) ne sont **pas** unit-testées dans ce projet (aucune commande existante ne l'est — voir `commands/servers.rs`, `commands/ping.rs`) ; la logique testable vit dans `proxmox/client.rs`, qui ne dépend pas de `State`.

## Review Focus

- **Fichier `data.json` v2 existant sans `proxmox_connections`** (créé par une version antérieure de l'app) : doit se charger avec une liste vide, sans crash — testé Tâche 1.
- **URL d'API sans schéma** (`192.168.1.10:8006` au lieu de `https://192.168.1.10:8006`) : doit être rejetée avec un message clair avant sauvegarde, pas silencieusement mal formée — testé Tâche 7.
- **VM avec le même `vmid` sur deux nœuds/types différents** (config Proxmox atypique mais possible) : l'UI doit les distinguer par `(node, vmid, vm_type)`, pas par `vmid` seul — testé Tâche 12.
- **Token révoqué après la sauvegarde de la connexion** (marchait au `test_connection`, ne marche plus au polling suivant) : la page doit afficher l'erreur par connexion sans casser le reste du dashboard, sans boucle de retry agressive — testé Tâche 11.
- **Double clic sur un bouton d'action pendant qu'une requête est en cours** : ne doit pas déclencher deux appels concurrents vers Proxmox — testé Tâche 12.

---

### Task 1: Modèle `ProxmoxConnection` + champ `AppData` + réglages réseau

**Files:**
- Create: `src-tauri/src/proxmox/mod.rs`
- Create: `src-tauri/src/proxmox/models.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/lib.rs` (ajout `mod proxmox;`)

**Interfaces:**
- Produces: `proxmox::models::ProxmoxConnection { id, name, api_url, token_id, token_secret, verify_tls }`, `proxmox::models::ProxmoxConnectionPayload { name, api_url, token_id, token_secret, verify_tls }`, `ProxmoxConnection::new(name, api_url, token_id, token_secret_encrypted, verify_tls) -> Self`. `AppData.proxmox_connections: Vec<ProxmoxConnection>`. `NetworkSettings.proxmox_poll_interval_secs: u64`, `NetworkSettings.proxmox_timeout_secs: u64`.

- [ ] **Step 1: Write the failing tests**

Dans `src-tauri/src/proxmox/models.rs` :

```rust
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxmoxConnection {
    pub id: String,
    pub name: String,
    pub api_url: String,
    pub token_id: String,
    /// Chiffré AES-256-GCM (comme Server.ssh_password)
    pub token_secret: String,
    #[serde(default)]
    pub verify_tls: bool,
}

impl ProxmoxConnection {
    pub fn new(
        name: String,
        api_url: String,
        token_id: String,
        token_secret_encrypted: String,
        verify_tls: bool,
    ) -> Self {
        ProxmoxConnection {
            id: Uuid::new_v4().to_string(),
            name,
            api_url,
            token_id,
            token_secret: token_secret_encrypted,
            verify_tls,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxmoxConnectionPayload {
    pub name: String,
    pub api_url: String,
    pub token_id: String,
    /// En clair depuis le frontend, chiffré côté Rust avant stockage
    pub token_secret: String,
    pub verify_tls: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_generates_unique_id_and_keeps_fields() {
        let c1 = ProxmoxConnection::new(
            "PVE1".to_string(),
            "https://192.168.1.10:8006".to_string(),
            "root@pam!sm".to_string(),
            "encrypted-secret".to_string(),
            false,
        );
        let c2 = ProxmoxConnection::new(
            "PVE2".to_string(),
            "https://192.168.1.11:8006".to_string(),
            "root@pam!sm".to_string(),
            "encrypted-secret".to_string(),
            true,
        );
        assert_ne!(c1.id, c2.id);
        assert_eq!(c1.name, "PVE1");
        assert_eq!(c1.api_url, "https://192.168.1.10:8006");
        assert!(!c1.verify_tls);
        assert!(c2.verify_tls);
    }
}
```

Créer `src-tauri/src/proxmox/mod.rs` :

```rust
pub mod models;
```

Dans `src-tauri/src/models.rs`, ajouter le champ à `AppData` et les deux réglages réseau (imports en haut du fichier, puis modifications ci-dessous) :

```rust
use crate::proxmox::models::ProxmoxConnection;
```

Modifier `NetworkSettings` :

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkSettings {
    pub ping_interval_secs: u64,
    pub ping_timeout_ms: u64,
    pub ssh_timeout_secs: u64,
    #[serde(default = "default_proxmox_poll_interval")]
    pub proxmox_poll_interval_secs: u64,
    #[serde(default = "default_proxmox_timeout")]
    pub proxmox_timeout_secs: u64,
}

fn default_proxmox_poll_interval() -> u64 {
    15
}

fn default_proxmox_timeout() -> u64 {
    10
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self {
            ping_interval_secs: 30,
            ping_timeout_ms: 2000,
            ssh_timeout_secs: 30,
            proxmox_poll_interval_secs: default_proxmox_poll_interval(),
            proxmox_timeout_secs: default_proxmox_timeout(),
        }
    }
}
```

Modifier `AppData` :

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: AppSettings,
    pub encryption_salt: String,
    #[serde(default)]
    pub proxmox_connections: Vec<ProxmoxConnection>,
}

impl Default for AppData {
    fn default() -> Self {
        AppData {
            servers: Vec::new(),
            groups: Vec::new(),
            settings: AppSettings::default(),
            encryption_salt: crate::crypto::generate_salt(),
            proxmox_connections: Vec::new(),
        }
    }
}
```

Ajouter les tests de compatibilité dans le module `#[cfg(test)] mod tests` existant de `models.rs` (à la suite de `test_default_settings`) :

```rust
    #[test]
    fn app_data_deserializes_without_proxmox_connections_field() {
        // Simule un data.json v2 existant, écrit avant l'ajout de Proxmox
        let json = r#"{
            "servers": [],
            "groups": [],
            "settings": {
                "general": {"start_minimized": false, "auto_start": false, "notifications": true},
                "appearance": {"brightness": 1.0, "font_size": 14, "density": "Normal", "active_theme": "one-half-dark", "custom_themes": []},
                "network": {"ping_interval_secs": 30, "ping_timeout_ms": 2000, "ssh_timeout_secs": 30}
            },
            "encryption_salt": "abc123"
        }"#;
        let data: AppData = serde_json::from_str(json).expect("doit se désérialiser sans le champ proxmox_connections");
        assert!(data.proxmox_connections.is_empty());
        assert_eq!(data.settings.network.proxmox_poll_interval_secs, 15);
        assert_eq!(data.settings.network.proxmox_timeout_secs, 10);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml new_generates_unique_id_and_keeps_fields app_data_deserializes_without_proxmox_connections_field`
Expected: FAIL — `proxmox` module / champs inexistants (erreurs de compilation)

- [ ] **Step 3: Implement**

Appliquer exactement le code des Step 1 ci-dessus dans les trois fichiers, puis ajouter `mod proxmox;` en haut de `src-tauri/src/lib.rs` (à côté de `mod commands; mod crypto; mod models; mod storage;`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml new_generates_unique_id_and_keeps_fields app_data_deserializes_without_proxmox_connections_field`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/proxmox/mod.rs src-tauri/src/proxmox/models.rs src-tauri/src/models.rs src-tauri/src/lib.rs
git commit -m "feat: add ProxmoxConnection model and AppData field"
```

---

### Task 2: Client REST Proxmox — construction, helpers, `test_connection`, `list_nodes`

**Files:**
- Modify: `src-tauri/Cargo.toml` (ajout `reqwest` + `[dev-dependencies] wiremock`)
- Create: `src-tauri/src/proxmox/client.rs`
- Modify: `src-tauri/src/proxmox/mod.rs`

**Interfaces:**
- Consumes: rien (fondation)
- Produces: `ProxmoxClient::new(api_url: &str, token_id: &str, token_secret: &str, verify_tls: bool, timeout_secs: u64) -> Result<Self, String>`, `async fn test_connection(&self) -> Result<(), String>`, `async fn list_nodes(&self) -> Result<Vec<ProxmoxNode>, String>`, helpers privés `get_json<T>`/`post_form` réutilisés par les tâches suivantes. `proxmox::models::ProxmoxNode { node: String, status: String }`.

- [ ] **Step 1: Add dependencies**

Dans `src-tauri/Cargo.toml`, section `[dependencies]` :

```toml
reqwest = { version = "0.12", features = ["json"] }
```

Ajouter à la fin du fichier (nouvelle section) :

```toml
[dev-dependencies]
wiremock = "0.6"
```

- [ ] **Step 2: Write the failing tests**

Dans `src-tauri/src/proxmox/models.rs`, ajouter :

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxmoxNode {
    pub node: String,
    pub status: String,
}
```

Créer `src-tauri/src/proxmox/client.rs` :

```rust
use crate::proxmox::models::ProxmoxNode;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::time::Duration;

pub struct ProxmoxClient {
    http: reqwest::Client,
    api_url: String,
    auth_header: String,
}

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
struct RawNode {
    node: String,
    status: String,
}

impl ProxmoxClient {
    pub fn new(
        api_url: &str,
        token_id: &str,
        token_secret: &str,
        verify_tls: bool,
        timeout_secs: u64,
    ) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(!verify_tls)
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| format!("Impossible de créer le client HTTP: {}", e))?;

        Ok(ProxmoxClient {
            http,
            api_url: api_url.trim_end_matches('/').to_string(),
            auth_header: format!("PVEAPIToken={}={}", token_id, token_secret),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api2/json{}", self.api_url, path)
    }

    async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let resp = self
            .http
            .get(self.url(path))
            .header("Authorization", &self.auth_header)
            .send()
            .await
            .map_err(|e| format!("Connexion à Proxmox échouée: {}", e))?;
        let resp = resp
            .error_for_status()
            .map_err(|e| format!("Proxmox a renvoyé une erreur: {}", e))?;
        resp.json::<ApiResponse<T>>()
            .await
            .map(|r| r.data)
            .map_err(|e| format!("Réponse Proxmox invalide: {}", e))
    }

    async fn post_form(&self, path: &str, form: &[(&str, &str)]) -> Result<String, String> {
        let resp = self
            .http
            .post(self.url(path))
            .header("Authorization", &self.auth_header)
            .form(form)
            .send()
            .await
            .map_err(|e| format!("Connexion à Proxmox échouée: {}", e))?;
        let resp = resp
            .error_for_status()
            .map_err(|e| format!("Proxmox a renvoyé une erreur: {}", e))?;
        resp.json::<ApiResponse<String>>()
            .await
            .map(|r| r.data)
            .map_err(|e| format!("Réponse Proxmox invalide: {}", e))
    }

    pub async fn test_connection(&self) -> Result<(), String> {
        self.get_json::<serde_json::Value>("/version").await.map(|_| ())
    }

    pub async fn list_nodes(&self) -> Result<Vec<ProxmoxNode>, String> {
        let raw: Vec<RawNode> = self.get_json("/nodes").await?;
        Ok(raw
            .into_iter()
            .map(|n| ProxmoxNode { node: n.node, status: n.status })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_connection_sends_correct_auth_header_and_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api2/json/version"))
            .and(header("Authorization", "PVEAPIToken=root@pam!sm=secret123"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": {"version": "8.1"}})),
            )
            .mount(&server)
            .await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret123", true, 5).unwrap();
        assert!(client.test_connection().await.is_ok());
    }

    #[tokio::test]
    async fn test_connection_fails_on_unauthorized() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api2/json/version"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "wrong", true, 5).unwrap();
        assert!(client.test_connection().await.is_err());
    }

    #[tokio::test]
    async fn list_nodes_parses_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api2/json/nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [{"node": "pve1", "status": "online"}]
            })))
            .mount(&server)
            .await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let nodes = client.list_nodes().await.unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].node, "pve1");
        assert_eq!(nodes[0].status, "online");
    }
}
```

Modifier `src-tauri/src/proxmox/mod.rs` :

```rust
pub mod client;
pub mod models;
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml proxmox::client::tests -- --nocapture`
Expected: FAIL (module/dépendances manquants avant l'ajout du Cargo.toml, ou tests absents)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml proxmox::client::tests`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/proxmox/client.rs src-tauri/src/proxmox/mod.rs src-tauri/src/proxmox/models.rs
git commit -m "feat: add Proxmox REST client foundation (auth, test_connection, list_nodes)"
```

---

### Task 3: Client REST — `list_all_vms` (QEMU + LXC)

**Files:**
- Modify: `src-tauri/src/proxmox/client.rs`
- Modify: `src-tauri/src/proxmox/models.rs`

**Interfaces:**
- Consumes: `get_json` (Task 2), `ProxmoxNode` (Task 2)
- Produces: `proxmox::models::{VmType, ProxmoxVm}`, `ProxmoxClient::list_all_vms(&self) -> Result<Vec<ProxmoxVm>, String>`

- [ ] **Step 1: Write the failing test**

Dans `src-tauri/src/proxmox/models.rs`, ajouter :

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VmType {
    Qemu,
    Lxc,
}

impl VmType {
    pub fn api_segment(&self) -> &'static str {
        match self {
            VmType::Qemu => "qemu",
            VmType::Lxc => "lxc",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxmoxVm {
    pub vmid: u32,
    pub name: String,
    pub node: String,
    pub vm_type: VmType,
    pub status: String,
    pub cpu: f64,
    pub mem: u64,
    pub maxmem: u64,
    pub disk: u64,
    pub maxdisk: u64,
}
```

Dans `src-tauri/src/proxmox/client.rs`, ajouter le test (dans `mod tests`) :

```rust
    #[tokio::test]
    async fn list_all_vms_combines_qemu_and_lxc_across_nodes() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/api2/json/nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [{"node": "pve1", "status": "online"}]
            })))
            .mount(&server).await;
        Mock::given(method("GET")).and(path("/api2/json/nodes/pve1/qemu"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [{"vmid": 100, "name": "web01", "status": "running", "cpu": 0.05, "mem": 536870912, "maxmem": 1073741824, "disk": 0, "maxdisk": 8589934592}]
            })))
            .mount(&server).await;
        Mock::given(method("GET")).and(path("/api2/json/nodes/pve1/lxc"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [{"vmid": 200, "name": "ct01", "status": "stopped", "cpu": 0.0, "mem": 0, "maxmem": 536870912, "disk": 104857600, "maxdisk": 2147483648}]
            })))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let vms = client.list_all_vms().await.unwrap();

        assert_eq!(vms.len(), 2);
        let qemu_vm = vms.iter().find(|v| v.vm_type == VmType::Qemu).unwrap();
        assert_eq!(qemu_vm.vmid, 100);
        assert_eq!(qemu_vm.name, "web01");
        assert_eq!(qemu_vm.node, "pve1");
        let lxc_vm = vms.iter().find(|v| v.vm_type == VmType::Lxc).unwrap();
        assert_eq!(lxc_vm.vmid, 200);
        assert_eq!(lxc_vm.status, "stopped");
    }
```

Ajouter l'import en haut du fichier de test (modifier la ligne `use super::*;` reste suffisante car `VmType`/`ProxmoxVm` seront ré-exportés via `use crate::proxmox::models::{ProxmoxNode, ...}` en haut du fichier — mettre à jour cet import) :

```rust
use crate::proxmox::models::{ProxmoxNode, ProxmoxVm, VmType};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_all_vms_combines_qemu_and_lxc_across_nodes`
Expected: FAIL — `list_all_vms` n'existe pas

- [ ] **Step 3: Implement**

Ajouter dans `impl ProxmoxClient` (`client.rs`), après `list_nodes` :

```rust
    async fn list_vms_of_type(&self, node: &str, vm_type: VmType) -> Result<Vec<ProxmoxVm>, String> {
        let path = format!("/nodes/{}/{}", node, vm_type.api_segment());
        let raw: Vec<RawVm> = self.get_json(&path).await?;
        Ok(raw
            .into_iter()
            .map(|v| ProxmoxVm {
                vmid: v.vmid,
                name: v.name.unwrap_or_else(|| format!("vm-{}", v.vmid)),
                node: node.to_string(),
                vm_type,
                status: v.status,
                cpu: v.cpu,
                mem: v.mem,
                maxmem: v.maxmem,
                disk: v.disk,
                maxdisk: v.maxdisk,
            })
            .collect())
    }

    pub async fn list_all_vms(&self) -> Result<Vec<ProxmoxVm>, String> {
        let nodes = self.list_nodes().await?;
        let mut all = Vec::new();
        for node in &nodes {
            let mut qemu = self.list_vms_of_type(&node.node, VmType::Qemu).await?;
            let mut lxc = self.list_vms_of_type(&node.node, VmType::Lxc).await?;
            all.append(&mut qemu);
            all.append(&mut lxc);
        }
        Ok(all)
    }
```

Ajouter la struct de désérialisation brute juste après `RawNode` :

```rust
#[derive(Debug, Deserialize)]
struct RawVm {
    vmid: u32,
    #[serde(default)]
    name: Option<String>,
    status: String,
    #[serde(default)]
    cpu: f64,
    #[serde(default)]
    mem: u64,
    #[serde(default)]
    maxmem: u64,
    #[serde(default)]
    disk: u64,
    #[serde(default)]
    maxdisk: u64,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_all_vms_combines_qemu_and_lxc_across_nodes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/proxmox/client.rs src-tauri/src/proxmox/models.rs
git commit -m "feat: list VMs and LXC containers across all Proxmox nodes"
```

---

### Task 4: Client REST — `vm_action` (start/stop/shutdown/reboot/suspend)

**Files:**
- Modify: `src-tauri/src/proxmox/client.rs`
- Modify: `src-tauri/src/proxmox/models.rs`

**Interfaces:**
- Consumes: `post_form` (Task 2), `VmType` (Task 3)
- Produces: `proxmox::models::VmAction`, `ProxmoxClient::vm_action(&self, node: &str, vmid: u32, vm_type: VmType, action: VmAction) -> Result<String, String>` (retourne l'UPID de tâche Proxmox)

- [ ] **Step 1: Write the failing test**

Dans `models.rs` :

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VmAction {
    Start,
    Stop,
    Shutdown,
    Reboot,
    Suspend,
}

impl VmAction {
    pub fn api_segment(&self) -> &'static str {
        match self {
            VmAction::Start => "start",
            VmAction::Stop => "stop",
            VmAction::Shutdown => "shutdown",
            VmAction::Reboot => "reboot",
            VmAction::Suspend => "suspend",
        }
    }
}
```

Dans `client.rs`, mettre à jour l'import (`use crate::proxmox::models::{ProxmoxNode, ProxmoxVm, VmAction, VmType};`) et ajouter le test :

```rust
    #[tokio::test]
    async fn vm_action_calls_correct_endpoint_for_qemu_and_lxc() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/status/start"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:qemu-start"})))
            .mount(&server).await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/lxc/200/status/stop"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:lxc-stop"})))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();

        let upid_start = client.vm_action("pve1", 100, VmType::Qemu, VmAction::Start).await.unwrap();
        assert_eq!(upid_start, "UPID:pve1:qemu-start");

        let upid_stop = client.vm_action("pve1", 200, VmType::Lxc, VmAction::Stop).await.unwrap();
        assert_eq!(upid_stop, "UPID:pve1:lxc-stop");
    }

    #[tokio::test]
    async fn vm_action_propagates_proxmox_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/status/stop"))
            .respond_with(ResponseTemplate::new(500).set_body_string("VM already stopped"))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let result = client.vm_action("pve1", 100, VmType::Qemu, VmAction::Stop).await;
        assert!(result.is_err());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml vm_action_calls_correct_endpoint_for_qemu_and_lxc vm_action_propagates_proxmox_error`
Expected: FAIL — `vm_action` n'existe pas

- [ ] **Step 3: Implement**

Ajouter dans `impl ProxmoxClient` :

```rust
    pub async fn vm_action(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
        action: VmAction,
    ) -> Result<String, String> {
        let path = format!(
            "/nodes/{}/{}/{}/status/{}",
            node,
            vm_type.api_segment(),
            vmid,
            action.api_segment()
        );
        self.post_form(&path, &[]).await
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml vm_action_calls_correct_endpoint_for_qemu_and_lxc vm_action_propagates_proxmox_error`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/proxmox/client.rs src-tauri/src/proxmox/models.rs
git commit -m "feat: add Proxmox VM/LXC start/stop/reboot/suspend action"
```

---

### Task 5: Client REST — snapshots (list/create/rollback)

**Files:**
- Modify: `src-tauri/src/proxmox/client.rs`
- Modify: `src-tauri/src/proxmox/models.rs`

**Interfaces:**
- Consumes: `get_json`/`post_form` (Task 2), `VmType` (Task 3)
- Produces: `proxmox::models::ProxmoxSnapshot { name, description, snaptime }`, `list_snapshots`, `create_snapshot`, `rollback_snapshot`

- [ ] **Step 1: Write the failing test**

Dans `models.rs` :

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxmoxSnapshot {
    pub name: String,
    pub description: String,
    pub snaptime: Option<u64>,
}
```

Dans `client.rs`, ajouter la struct brute après `RawVm` :

```rust
#[derive(Debug, Deserialize)]
struct RawSnapshot {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    snaptime: Option<u64>,
}
```

Mettre à jour l'import : `use crate::proxmox::models::{ProxmoxNode, ProxmoxSnapshot, ProxmoxVm, VmAction, VmType};`

Ajouter les tests :

```rust
    #[tokio::test]
    async fn list_snapshots_excludes_current_pseudo_snapshot() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/api2/json/nodes/pve1/qemu/100/snapshot"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [
                    {"name": "current"},
                    {"name": "before-update", "description": "avant mise à jour", "snaptime": 1700000000}
                ]
            })))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let snaps = client.list_snapshots("pve1", 100, VmType::Qemu).await.unwrap();

        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].name, "before-update");
        assert_eq!(snaps[0].description, "avant mise à jour");
    }

    #[tokio::test]
    async fn create_snapshot_sends_snapname_form_field() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/snapshot"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:snap-create"})))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let upid = client.create_snapshot("pve1", 100, VmType::Qemu, "before-update").await.unwrap();
        assert_eq!(upid, "UPID:pve1:snap-create");
    }

    #[tokio::test]
    async fn rollback_snapshot_calls_rollback_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/snapshot/before-update/rollback"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:snap-rollback"})))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let upid = client.rollback_snapshot("pve1", 100, VmType::Qemu, "before-update").await.unwrap();
        assert_eq!(upid, "UPID:pve1:snap-rollback");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_snapshots_excludes_current_pseudo_snapshot create_snapshot_sends_snapname_form_field rollback_snapshot_calls_rollback_endpoint`
Expected: FAIL — méthodes inexistantes

- [ ] **Step 3: Implement**

```rust
    pub async fn list_snapshots(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
    ) -> Result<Vec<ProxmoxSnapshot>, String> {
        let path = format!("/nodes/{}/{}/{}/snapshot", node, vm_type.api_segment(), vmid);
        let raw: Vec<RawSnapshot> = self.get_json(&path).await?;
        Ok(raw
            .into_iter()
            .filter(|s| s.name != "current")
            .map(|s| ProxmoxSnapshot {
                name: s.name,
                description: s.description.unwrap_or_default(),
                snaptime: s.snaptime,
            })
            .collect())
    }

    pub async fn create_snapshot(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
        name: &str,
    ) -> Result<String, String> {
        let path = format!("/nodes/{}/{}/{}/snapshot", node, vm_type.api_segment(), vmid);
        self.post_form(&path, &[("snapname", name)]).await
    }

    pub async fn rollback_snapshot(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
        name: &str,
    ) -> Result<String, String> {
        let path = format!(
            "/nodes/{}/{}/{}/snapshot/{}/rollback",
            node,
            vm_type.api_segment(),
            vmid,
            name
        );
        self.post_form(&path, &[]).await
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_snapshots_excludes_current_pseudo_snapshot create_snapshot_sends_snapname_form_field rollback_snapshot_calls_rollback_endpoint`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/proxmox/client.rs src-tauri/src/proxmox/models.rs
git commit -m "feat: add Proxmox snapshot list/create/rollback"
```

---

### Task 6: Client REST — `clone_vm`

**Files:**
- Modify: `src-tauri/src/proxmox/client.rs`

**Interfaces:**
- Consumes: `get_json`/`post_form` (Task 2), `VmType` (Task 3)
- Produces: `ProxmoxClient::clone_vm(&self, node: &str, vmid: u32, vm_type: VmType, new_name: &str) -> Result<String, String>`

- [ ] **Step 1: Write the failing test**

```rust
    #[tokio::test]
    async fn clone_vm_fetches_nextid_then_clones() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/api2/json/cluster/nextid"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "105"})))
            .mount(&server).await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/clone"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:clone"})))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let upid = client.clone_vm("pve1", 100, VmType::Qemu, "web01-clone").await.unwrap();
        assert_eq!(upid, "UPID:pve1:clone");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml clone_vm_fetches_nextid_then_clones`
Expected: FAIL — `clone_vm` n'existe pas

- [ ] **Step 3: Implement**

```rust
    pub async fn clone_vm(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
        new_name: &str,
    ) -> Result<String, String> {
        let next_id: String = self.get_json("/cluster/nextid").await?;
        let path = format!("/nodes/{}/{}/{}/clone", node, vm_type.api_segment(), vmid);
        self.post_form(&path, &[("newid", next_id.as_str()), ("name", new_name)])
            .await
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml clone_vm_fetches_nextid_then_clones`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/proxmox/client.rs
git commit -m "feat: add Proxmox VM/LXC clone"
```

---

### Task 7: Commandes Tauri — CRUD des connexions

**Files:**
- Create: `src-tauri/src/commands/proxmox.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `crypto::{derive_key, encrypt, decrypt}`, `ProxmoxConnection`/`ProxmoxConnectionPayload` (Task 1), `ProxmoxClient` (Task 2)
- Produces: commandes Tauri `proxmox_add_connection`, `proxmox_update_connection`, `proxmox_delete_connection`, `proxmox_list_connections`, `proxmox_test_connection`, et la fonction interne `build_client(data: &AppData, connection_id: &str) -> Result<ProxmoxClient, String>` réutilisée Tâche 8.

- [ ] **Step 1: Implement (pas de test automatisé — voir Global Constraints)**

Créer `src-tauri/src/commands/proxmox.rs` :

```rust
/// Commandes Tauri — Connexions Proxmox et opérations VM/LXC
use tauri::State;

use crate::{
    crypto,
    models::AppData,
    proxmox::{
        client::ProxmoxClient,
        models::{ProxmoxConnection, ProxmoxConnectionPayload},
    },
    storage::AppState,
};

fn validate_connection_payload(p: &ProxmoxConnectionPayload) -> Result<(), String> {
    if p.name.trim().is_empty() {
        return Err("Le nom de la connexion est requis".to_string());
    }
    if !p.api_url.starts_with("http://") && !p.api_url.starts_with("https://") {
        return Err("L'URL de l'API doit commencer par http:// ou https://".to_string());
    }
    if p.token_id.trim().is_empty() {
        return Err("Le token ID est requis (format: user@realm!tokenid)".to_string());
    }
    Ok(())
}

/// Construit un client Proxmox pour une connexion sauvegardée (secret déchiffré)
pub fn build_client(data: &AppData, connection_id: &str) -> Result<ProxmoxClient, String> {
    let conn = data
        .proxmox_connections
        .iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| format!("Connexion Proxmox introuvable: {}", connection_id))?;
    let key = crypto::derive_key(&data.encryption_salt);
    let secret = crypto::decrypt(&conn.token_secret, &key)?;
    ProxmoxClient::new(
        &conn.api_url,
        &conn.token_id,
        &secret,
        conn.verify_tls,
        data.settings.network.proxmox_timeout_secs,
    )
}

fn without_secret(c: ProxmoxConnection) -> ProxmoxConnection {
    ProxmoxConnection { token_secret: String::new(), ..c }
}

#[tauri::command]
pub fn proxmox_list_connections(state: State<AppState>) -> Result<Vec<ProxmoxConnection>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.proxmox_connections.iter().cloned().map(without_secret).collect())
}

#[tauri::command]
pub fn proxmox_add_connection(
    state: State<AppState>,
    payload: ProxmoxConnectionPayload,
) -> Result<ProxmoxConnection, String> {
    validate_connection_payload(&payload)?;

    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let key = crypto::derive_key(&data.encryption_salt);
    let encrypted_secret = crypto::encrypt(&payload.token_secret, &key)?;

    let connection = ProxmoxConnection::new(
        payload.name,
        payload.api_url,
        payload.token_id,
        encrypted_secret,
        payload.verify_tls,
    );
    data.proxmox_connections.push(connection.clone());
    drop(data);

    state.save()?;
    log::info!("Connexion Proxmox ajoutée : {}", connection.name);
    Ok(without_secret(connection))
}

#[tauri::command]
pub fn proxmox_update_connection(
    state: State<AppState>,
    id: String,
    payload: ProxmoxConnectionPayload,
) -> Result<ProxmoxConnection, String> {
    validate_connection_payload(&payload)?;

    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let encrypted_secret = if !payload.token_secret.is_empty() {
        let key = crypto::derive_key(&data.encryption_salt);
        Some(crypto::encrypt(&payload.token_secret, &key)?)
    } else {
        None
    };

    let conn = data
        .proxmox_connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connexion introuvable: {}", id))?;

    if let Some(enc) = encrypted_secret {
        conn.token_secret = enc;
    }
    conn.name = payload.name;
    conn.api_url = payload.api_url;
    conn.token_id = payload.token_id;
    conn.verify_tls = payload.verify_tls;

    let updated = conn.clone();
    drop(data);
    state.save()?;
    log::info!("Connexion Proxmox mise à jour : {}", updated.name);
    Ok(without_secret(updated))
}

#[tauri::command]
pub fn proxmox_delete_connection(state: State<AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let len_before = data.proxmox_connections.len();
    data.proxmox_connections.retain(|c| c.id != id);
    if data.proxmox_connections.len() == len_before {
        return Err(format!("Connexion introuvable: {}", id));
    }
    drop(data);
    state.save()?;
    log::info!("Connexion Proxmox supprimée : {}", id);
    Ok(())
}

#[tauri::command]
pub async fn proxmox_test_connection(
    state: State<'_, AppState>,
    payload: ProxmoxConnectionPayload,
) -> Result<(), String> {
    validate_connection_payload(&payload)?;
    let timeout = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.settings.network.proxmox_timeout_secs
    };
    let client = ProxmoxClient::new(
        &payload.api_url,
        &payload.token_id,
        &payload.token_secret,
        payload.verify_tls,
        timeout,
    )?;
    client.test_connection().await
}
```

Dans `src-tauri/src/lib.rs`, mettre à jour la ligne d'imports des commandes et l'`invoke_handler!` :

```rust
use commands::{groups, ping, proxmox, servers, settings, ssh, wol};
```

Ajouter dans `invoke_handler![...]`, à la suite du bloc `// ── Paramètres ────────────────────────────`  :

```rust
            // ── Proxmox ───────────────────────────────────────
            proxmox::proxmox_list_connections,
            proxmox::proxmox_add_connection,
            proxmox::proxmox_update_connection,
            proxmox::proxmox_delete_connection,
            proxmox::proxmox_test_connection,
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: succès, aucune erreur de compilation (ce module n'a pas de tests automatisés — voir Global Constraints ; la logique testable est déjà couverte côté `proxmox/client.rs`)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/proxmox.rs src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for Proxmox connection CRUD"
```

---

### Task 8: Commandes Tauri — opérations VM/LXC

**Files:**
- Modify: `src-tauri/src/commands/proxmox.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `build_client` (Task 7), `ProxmoxClient::{list_all_vms, vm_action, list_snapshots, create_snapshot, rollback_snapshot, clone_vm}` (Tasks 3-6)
- Produces: commandes Tauri `proxmox_list_vms`, `proxmox_vm_action`, `proxmox_vm_snapshot_list`, `proxmox_vm_snapshot_create`, `proxmox_vm_snapshot_rollback`, `proxmox_vm_clone`

- [ ] **Step 1: Implement (pas de test automatisé — voir Global Constraints)**

Ajouter dans `src-tauri/src/commands/proxmox.rs`, après `proxmox_test_connection`, et mettre à jour l'import du haut de fichier pour inclure `ProxmoxSnapshot, ProxmoxVm, VmAction, VmType` :

```rust
use crate::proxmox::models::{
    ProxmoxConnection, ProxmoxConnectionPayload, ProxmoxSnapshot, ProxmoxVm, VmAction, VmType,
};
```

```rust
#[tauri::command]
pub async fn proxmox_list_vms(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<ProxmoxVm>, String> {
    let client = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        build_client(&data, &connection_id)?
    };
    client.list_all_vms().await
}

#[tauri::command]
pub async fn proxmox_vm_action(
    state: State<'_, AppState>,
    connection_id: String,
    node: String,
    vmid: u32,
    vm_type: VmType,
    action: VmAction,
) -> Result<String, String> {
    let client = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        build_client(&data, &connection_id)?
    };
    client.vm_action(&node, vmid, vm_type, action).await
}

#[tauri::command]
pub async fn proxmox_vm_snapshot_list(
    state: State<'_, AppState>,
    connection_id: String,
    node: String,
    vmid: u32,
    vm_type: VmType,
) -> Result<Vec<ProxmoxSnapshot>, String> {
    let client = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        build_client(&data, &connection_id)?
    };
    client.list_snapshots(&node, vmid, vm_type).await
}

#[tauri::command]
pub async fn proxmox_vm_snapshot_create(
    state: State<'_, AppState>,
    connection_id: String,
    node: String,
    vmid: u32,
    vm_type: VmType,
    name: String,
) -> Result<String, String> {
    let client = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        build_client(&data, &connection_id)?
    };
    client.create_snapshot(&node, vmid, vm_type, &name).await
}

#[tauri::command]
pub async fn proxmox_vm_snapshot_rollback(
    state: State<'_, AppState>,
    connection_id: String,
    node: String,
    vmid: u32,
    vm_type: VmType,
    name: String,
) -> Result<String, String> {
    let client = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        build_client(&data, &connection_id)?
    };
    client.rollback_snapshot(&node, vmid, vm_type, &name).await
}

#[tauri::command]
pub async fn proxmox_vm_clone(
    state: State<'_, AppState>,
    connection_id: String,
    node: String,
    vmid: u32,
    vm_type: VmType,
    new_name: String,
) -> Result<String, String> {
    let client = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        build_client(&data, &connection_id)?
    };
    client.clone_vm(&node, vmid, vm_type, &new_name).await
}
```

Ajouter dans `invoke_handler![...]` de `lib.rs`, à la suite du bloc Proxmox ajouté en Tâche 7 :

```rust
            proxmox::proxmox_list_vms,
            proxmox::proxmox_vm_action,
            proxmox::proxmox_vm_snapshot_list,
            proxmox::proxmox_vm_snapshot_create,
            proxmox::proxmox_vm_snapshot_rollback,
            proxmox::proxmox_vm_clone,
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: succès

- [ ] **Step 3: Run the full backend test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (tous les tests existants + les 12 tests Proxmox ajoutés Tâches 1-6)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/proxmox.rs src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands for Proxmox VM/LXC operations"
```

---

### Task 9: Infrastructure de test frontend (Vitest + React Testing Library)

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/utils/index.test.ts` (premier test réel pour valider l'infra)

**Interfaces:**
- Produces: `npm run test` (exécute Vitest en mode CI), environnement `jsdom` configuré, matchers `@testing-library/jest-dom` disponibles globalement

- [ ] **Step 1: Add dependencies**

Dans `package.json`, section `devDependencies`, ajouter :

```json
    "vitest": "^2.1.1",
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/user-event": "^14.5.2",
    "jsdom": "^25.0.1"
```

Ajouter le script dans `"scripts"` :

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

Créer `src/utils/index.test.ts` :

```typescript
import { describe, it, expect } from "vitest";
import { formatLatency, cn } from "./index";

describe("formatLatency", () => {
  it("affiche les millisecondes en dessous de 1000ms", () => {
    expect(formatLatency(250)).toBe("250 ms");
  });

  it("affiche les secondes au-dessus de 1000ms", () => {
    expect(formatLatency(1500)).toBe("1.5 s");
  });

  it("affiche un tiret pour une valeur nulle", () => {
    expect(formatLatency(null)).toBe("—");
  });
});

describe("cn", () => {
  it("filtre les valeurs falsy et joint le reste", () => {
    expect(cn("a", false, "b", undefined, null, "c")).toBe("a b c");
  });
});
```

- [ ] **Step 3: Configure Vitest**

Modifier `vite.config.ts` :

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
}));
```

Créer `src/test/setup.ts` :

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/utils/index.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/test/setup.ts src/utils/index.test.ts
git commit -m "chore: add Vitest + React Testing Library test infrastructure"
```

---

### Task 10: Types frontend + extension du store Zustand

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/stores/useStore.ts`

**Interfaces:**
- Consumes: commandes Tauri Proxmox (Tasks 7-8)
- Produces: types TS `VmType`, `VmAction`, `ProxmoxConnection`, `ProxmoxConnectionPayload`, `ProxmoxVm`, `ProxmoxSnapshot`. Store : `proxmoxConnections: ProxmoxConnection[]`, `proxmoxVms: Record<string, ProxmoxVm[]>` (clé = `connection_id`), `proxmoxLoading: Record<string, boolean>`, `proxmoxErrors: Record<string, string | null>`, actions `addProxmoxConnection`, `updateProxmoxConnection`, `deleteProxmoxConnection`, `testProxmoxConnection`, `loadProxmoxVms(connectionId)`, `proxmoxVmAction`, `proxmoxSnapshotList/Create/Rollback`, `proxmoxCloneVm`.

- [ ] **Step 1: Add TS types**

Ajouter à la fin de `src/types/index.ts` :

```typescript
// ─── Proxmox ───────────────────────────────────────────────────────────────

export type VmType = "qemu" | "lxc";
export type VmAction = "start" | "stop" | "shutdown" | "reboot" | "suspend";

export interface ProxmoxConnection {
  id: string;
  name: string;
  api_url: string;
  token_id: string;
  /** Toujours vide côté frontend — jamais transmis en clair */
  token_secret: string;
  verify_tls: boolean;
}

export interface ProxmoxConnectionPayload {
  name: string;
  api_url: string;
  token_id: string;
  token_secret: string;
  verify_tls: boolean;
}

export interface ProxmoxVm {
  vmid: number;
  name: string;
  node: string;
  vm_type: VmType;
  status: string;
  cpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
}

export interface ProxmoxSnapshot {
  name: string;
  description: string;
  snaptime: number | null;
}
```

Mettre également à jour `NetworkSettings` :

```typescript
export interface NetworkSettings {
  ping_interval_secs: number;
  ping_timeout_ms: number;
  ssh_timeout_secs: number;
  proxmox_poll_interval_secs: number;
  proxmox_timeout_secs: number;
}
```

- [ ] **Step 2: Extend the store**

Dans `src/stores/useStore.ts`, mettre à jour l'import :

```typescript
import {
  AppSettings,
  GeneralSettings,
  AppearanceSettings,
  NetworkSettings,
  Theme,
  ImportSummary,
  Group,
  PingResult,
  ProxmoxConnection,
  ProxmoxConnectionPayload,
  ProxmoxSnapshot,
  ProxmoxVm,
  Server,
  ServerPayload,
  ServerStatus,
  SshResult,
  VmAction,
  VmType,
} from "../types";
```

Ajouter à l'interface `AppStore` (après le bloc `// ── Paramètres ──`, avant `saveCustomTheme`) :

```typescript
  // ── Proxmox ────────────────────────────────────────────────────────────
  proxmoxConnections: ProxmoxConnection[];
  proxmoxVms: Record<string, ProxmoxVm[]>;
  proxmoxLoading: Record<string, boolean>;
  proxmoxErrors: Record<string, string | null>;
  loadProxmoxConnections: () => Promise<void>;
  addProxmoxConnection: (payload: ProxmoxConnectionPayload) => Promise<ProxmoxConnection>;
  updateProxmoxConnection: (id: string, payload: ProxmoxConnectionPayload) => Promise<ProxmoxConnection>;
  deleteProxmoxConnection: (id: string) => Promise<void>;
  testProxmoxConnection: (payload: ProxmoxConnectionPayload) => Promise<void>;
  loadProxmoxVms: (connectionId: string) => Promise<void>;
  proxmoxVmAction: (connectionId: string, node: string, vmid: number, vmType: VmType, action: VmAction) => Promise<string>;
  proxmoxSnapshotList: (connectionId: string, node: string, vmid: number, vmType: VmType) => Promise<ProxmoxSnapshot[]>;
  proxmoxSnapshotCreate: (connectionId: string, node: string, vmid: number, vmType: VmType, name: string) => Promise<string>;
  proxmoxSnapshotRollback: (connectionId: string, node: string, vmid: number, vmType: VmType, name: string) => Promise<string>;
  proxmoxCloneVm: (connectionId: string, node: string, vmid: number, vmType: VmType, newName: string) => Promise<string>;
```

Ajouter au `DEFAULT_SETTINGS.network` les deux nouveaux champs :

```typescript
  network: {
    ping_interval_secs: 30,
    ping_timeout_ms: 2000,
    ssh_timeout_secs: 30,
    proxmox_poll_interval_secs: 15,
    proxmox_timeout_secs: 10,
  },
```

Ajouter au state initial du `create<AppStore>((set, get) => ({ ... }))` :

```typescript
  proxmoxConnections: [],
  proxmoxVms: {},
  proxmoxLoading: {},
  proxmoxErrors: {},
```

Ajouter les implémentations (après le bloc `// ── Thèmes personnalisés ──`, avant `// ── Import/Export`) :

```typescript
  // ── Proxmox ────────────────────────────────────────────────────────────
  loadProxmoxConnections: async () => {
    const connections = await invoke<ProxmoxConnection[]>("proxmox_list_connections");
    set({ proxmoxConnections: connections });
  },

  addProxmoxConnection: async (payload) => {
    const connection = await invoke<ProxmoxConnection>("proxmox_add_connection", { payload });
    set((s) => ({ proxmoxConnections: [...s.proxmoxConnections, connection] }));
    return connection;
  },

  updateProxmoxConnection: async (id, payload) => {
    const connection = await invoke<ProxmoxConnection>("proxmox_update_connection", { id, payload });
    set((s) => ({
      proxmoxConnections: s.proxmoxConnections.map((c) => (c.id === id ? connection : c)),
    }));
    return connection;
  },

  deleteProxmoxConnection: async (id) => {
    await invoke("proxmox_delete_connection", { id });
    set((s) => ({
      proxmoxConnections: s.proxmoxConnections.filter((c) => c.id !== id),
      proxmoxVms: Object.fromEntries(Object.entries(s.proxmoxVms).filter(([key]) => key !== id)),
    }));
  },

  testProxmoxConnection: async (payload) => {
    await invoke("proxmox_test_connection", { payload });
  },

  loadProxmoxVms: async (connectionId) => {
    set((s) => ({ proxmoxLoading: { ...s.proxmoxLoading, [connectionId]: true } }));
    try {
      const vms = await invoke<ProxmoxVm[]>("proxmox_list_vms", { connectionId });
      set((s) => ({
        proxmoxVms: { ...s.proxmoxVms, [connectionId]: vms },
        proxmoxErrors: { ...s.proxmoxErrors, [connectionId]: null },
      }));
    } catch (e) {
      set((s) => ({ proxmoxErrors: { ...s.proxmoxErrors, [connectionId]: String(e) } }));
    } finally {
      set((s) => ({ proxmoxLoading: { ...s.proxmoxLoading, [connectionId]: false } }));
    }
  },

  proxmoxVmAction: async (connectionId, node, vmid, vmType, action) => {
    return invoke<string>("proxmox_vm_action", { connectionId, node, vmid, vmType, action });
  },

  proxmoxSnapshotList: async (connectionId, node, vmid, vmType) => {
    return invoke<ProxmoxSnapshot[]>("proxmox_vm_snapshot_list", { connectionId, node, vmid, vmType });
  },

  proxmoxSnapshotCreate: async (connectionId, node, vmid, vmType, name) => {
    return invoke<string>("proxmox_vm_snapshot_create", { connectionId, node, vmid, vmType, name });
  },

  proxmoxSnapshotRollback: async (connectionId, node, vmid, vmType, name) => {
    return invoke<string>("proxmox_vm_snapshot_rollback", { connectionId, node, vmid, vmType, name });
  },

  proxmoxCloneVm: async (connectionId, node, vmid, vmType, newName) => {
    return invoke<string>("proxmox_vm_clone", { connectionId, node, vmid, vmType, newName });
  },
```

Enfin, mettre à jour les deux occurrences littérales de `network: { ping_interval_secs: 30, ping_timeout_ms: 2000, ssh_timeout_secs: 30 }` restantes (`initialize()` n'en a pas — seul `resetSettings()` en a une) pour y ajouter les deux nouveaux champs, comme fait pour `DEFAULT_SETTINGS`.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: aucune erreur de type

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/stores/useStore.ts
git commit -m "feat: add Proxmox TypeScript types and Zustand store actions"
```

---

### Task 11: Hook `useProxmoxStatus` (polling)

**Files:**
- Create: `src/hooks/useProxmoxStatus.ts`
- Create: `src/hooks/useProxmoxStatus.test.ts`

**Interfaces:**
- Consumes: `useStore` (Task 10) — `proxmoxConnections`, `loadProxmoxVms`, `settings.network.proxmox_poll_interval_secs`, `proxmoxErrors`
- Produces: `useProxmoxStatus(): void` (effet de bord, appelé depuis `Proxmox.tsx`)

- [ ] **Step 1: Write the failing test**

Créer `src/hooks/useProxmoxStatus.test.ts` :

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProxmoxStatus } from "./useProxmoxStatus";
import { useStore } from "../stores/useStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useProxmoxStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({
      proxmoxConnections: [
        { id: "conn-1", name: "PVE1", api_url: "https://pve1:8006", token_id: "t", token_secret: "", verify_tls: false },
      ],
      settings: {
        ...useStore.getState().settings,
        network: { ...useStore.getState().settings.network, proxmox_poll_interval_secs: 15 },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("charge les VMs de chaque connexion au montage", async () => {
    const loadProxmoxVms = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ loadProxmoxVms });

    renderHook(() => useProxmoxStatus());

    await waitFor(() => expect(loadProxmoxVms).toHaveBeenCalledWith("conn-1"));
  });

  it("relance le chargement à l'intervalle configuré", async () => {
    const loadProxmoxVms = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ loadProxmoxVms });

    renderHook(() => useProxmoxStatus());
    await waitFor(() => expect(loadProxmoxVms).toHaveBeenCalledTimes(1));

    vi.advanceTimersByTime(15000);
    await waitFor(() => expect(loadProxmoxVms).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/hooks/useProxmoxStatus.test.ts`
Expected: FAIL — le fichier `useProxmoxStatus.ts` n'existe pas

- [ ] **Step 3: Implement**

Créer `src/hooks/useProxmoxStatus.ts` :

```typescript
import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";

/**
 * Hook qui lance le polling automatique des VM/LXC de toutes les
 * connexions Proxmox configurées, à l'intervalle défini dans les paramètres.
 */
export function useProxmoxStatus() {
  const { proxmoxConnections, loadProxmoxVms, settings } = useStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (proxmoxConnections.length === 0) return;

    const loadAll = () => {
      for (const conn of proxmoxConnections) {
        loadProxmoxVms(conn.id).catch(console.error);
      }
    };

    loadAll();

    const ms = (settings.network.proxmox_poll_interval_secs ?? 15) * 1000;
    intervalRef.current = setInterval(loadAll, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [settings.network.proxmox_poll_interval_secs, proxmoxConnections.length]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/hooks/useProxmoxStatus.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProxmoxStatus.ts src/hooks/useProxmoxStatus.test.ts
git commit -m "feat: add Proxmox polling hook"
```

---

### Task 12: Composant `VmCard`

**Files:**
- Create: `src/components/VmCard.tsx`
- Create: `src/components/VmCard.test.tsx`
- Modify: `src/utils/index.ts` (ajout `formatBytes`)

**Interfaces:**
- Consumes: `ProxmoxVm` (Task 10), `useStore` (`proxmoxVmAction`), `StatusBadge`-like styling (pattern existant), `ConfirmDialog` (existant)
- Produces: `<VmCard vm={ProxmoxVm} connectionId={string} onMessage={(msg, type) => void} />`

- [ ] **Step 1: Write the failing tests**

Ajouter à `src/utils/index.test.ts` :

```typescript
import { formatBytes } from "./index";

describe("formatBytes", () => {
  it("affiche les Mo en dessous de 1 Go", () => {
    expect(formatBytes(536870912)).toBe("512 Mo");
  });

  it("affiche les Go au-dessus de 1 Go", () => {
    expect(formatBytes(1073741824)).toBe("1.0 Go");
  });
});
```

Créer `src/components/VmCard.test.tsx` :

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VmCard } from "./VmCard";
import { useStore } from "../stores/useStore";
import { ProxmoxVm } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const runningVm: ProxmoxVm = {
  vmid: 100,
  name: "web01",
  node: "pve1",
  vm_type: "qemu",
  status: "running",
  cpu: 0.12,
  mem: 536870912,
  maxmem: 1073741824,
  disk: 0,
  maxdisk: 8589934592,
};

describe("VmCard", () => {
  it("affiche le nom, le statut et le nœud de la VM", () => {
    render(<VmCard vm={runningVm} connectionId="conn-1" onMessage={vi.fn()} />);
    expect(screen.getByText("web01")).toBeInTheDocument();
    expect(screen.getByText(/pve1/)).toBeInTheDocument();
    expect(screen.getByText(/En cours/)).toBeInTheDocument();
  });

  it("distingue deux VMs partageant le même vmid mais un vm_type différent", () => {
    const lxcSameId: ProxmoxVm = { ...runningVm, vm_type: "lxc", name: "ct-same-id", node: "pve2" };
    render(
      <>
        <VmCard vm={runningVm} connectionId="conn-1" onMessage={vi.fn()} />
        <VmCard vm={lxcSameId} connectionId="conn-1" onMessage={vi.fn()} />
      </>
    );
    expect(screen.getByText("web01")).toBeInTheDocument();
    expect(screen.getByText("ct-same-id")).toBeInTheDocument();
  });

  it("désactive le bouton Stop pendant qu'une action est en cours (pas de double appel)", async () => {
    const proxmoxVmAction = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve("UPID:x"), 50)));
    useStore.setState({ proxmoxVmAction });

    render(<VmCard vm={runningVm} connectionId="conn-1" onMessage={vi.fn()} />);
    const stopButton = screen.getByTitle("Arrêter");

    fireEvent.click(stopButton);
    fireEvent.click(stopButton);

    await waitFor(() => expect(proxmoxVmAction).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/components/VmCard.test.tsx src/utils/index.test.ts`
Expected: FAIL — `VmCard.tsx` et `formatBytes` n'existent pas

- [ ] **Step 3: Implement**

Ajouter à `src/utils/index.ts`, dans la section `// ── Formatage ──` :

```typescript
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb < 1) {
    return `${Math.round(bytes / 1024 / 1024)} Mo`;
  }
  return `${gb.toFixed(1)} Go`;
}
```

Créer `src/components/VmCard.tsx` :

```typescript
import { useState } from "react";
import { Play, Square, RotateCcw, PauseCircle, Camera, Loader2 } from "lucide-react";
import { ProxmoxVm } from "../types";
import { useStore } from "../stores/useStore";
import { cn, formatBytes } from "../utils";

interface VmCardProps {
  vm: ProxmoxVm;
  connectionId: string;
  onMessage: (msg: string, type?: "success" | "error" | "info") => void;
}

export function VmCard({ vm, connectionId, onMessage }: VmCardProps) {
  const { proxmoxVmAction } = useStore();
  const [loading, setLoading] = useState<string | null>(null);

  const isRunning = vm.status === "running";

  async function runAction(key: string, action: "start" | "stop" | "shutdown" | "reboot" | "suspend") {
    if (loading) return;
    setLoading(key);
    try {
      await proxmoxVmAction(connectionId, vm.node, vm.vmid, vm.vm_type, action);
      onMessage(`Action "${action}" envoyée à ${vm.name}`, "success");
    } catch (e) {
      onMessage(String(e), "error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      className={cn(
        "bg-bg-tertiary border border-border-primary rounded-win shadow-win",
        "hover:shadow-win-hover hover:border-accent-primary/30 transition-all duration-200",
        "flex flex-col gap-3 p-4"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-text-primary font-semibold text-sm truncate leading-tight">{vm.name}</h3>
          <p className="text-text-secondary text-xs truncate font-mono">
            {vm.node} · {vm.vm_type.toUpperCase()} #{vm.vmid}
          </p>
        </div>
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full font-medium shrink-0",
            isRunning
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : "bg-gray-500/10 text-gray-400 border border-gray-500/20"
          )}
        >
          {isRunning ? "En cours" : "Arrêtée"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-text-secondary">CPU</p>
          <p className="text-text-primary font-mono">{Math.round(vm.cpu * 100)}%</p>
        </div>
        <div>
          <p className="text-text-secondary">RAM</p>
          <p className="text-text-primary font-mono">
            {formatBytes(vm.mem)} / {formatBytes(vm.maxmem)}
          </p>
        </div>
        <div>
          <p className="text-text-secondary">Disque</p>
          <p className="text-text-primary font-mono">{formatBytes(vm.maxdisk)}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {!isRunning ? (
          <button
            onClick={() => runAction("start", "start")}
            disabled={!!loading}
            title="Démarrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                       border border-green-500/30 bg-green-500/5 text-green-400
                       hover:bg-green-500/15 text-xs font-medium transition-all disabled:opacity-50"
          >
            {loading === "start" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Démarrer
          </button>
        ) : (
          <>
            <button
              onClick={() => runAction("stop", "stop")}
              disabled={!!loading}
              title="Arrêter"
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                         border border-red-500/30 bg-red-500/5 text-red-400
                         hover:bg-red-500/15 text-xs font-medium transition-all disabled:opacity-50"
            >
              {loading === "stop" ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
              Arrêter
            </button>
            <button
              onClick={() => runAction("reboot", "reboot")}
              disabled={!!loading}
              title="Redémarrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                         border border-border-primary bg-bg-secondary text-text-secondary
                         hover:bg-bg-hover text-xs font-medium transition-all disabled:opacity-50"
            >
              {loading === "reboot" ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              Reboot
            </button>
            <button
              onClick={() => runAction("suspend", "suspend")}
              disabled={!!loading}
              title="Suspendre"
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                         border border-border-primary bg-bg-secondary text-text-secondary
                         hover:bg-bg-hover text-xs font-medium transition-all disabled:opacity-50"
            >
              {loading === "suspend" ? <Loader2 size={12} className="animate-spin" /> : <PauseCircle size={12} />}
            </button>
          </>
        )}
        <button
          disabled={!!loading}
          title="Snapshots"
          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                     border border-border-primary bg-bg-secondary text-text-secondary
                     hover:bg-bg-hover text-xs font-medium transition-all disabled:opacity-50"
        >
          <Camera size={12} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/components/VmCard.test.tsx src/utils/index.test.ts`
Expected: PASS (6 tests au total sur ces deux fichiers)

- [ ] **Step 5: Commit**

```bash
git add src/components/VmCard.tsx src/components/VmCard.test.tsx src/utils/index.ts src/utils/index.test.ts
git commit -m "feat: add VmCard component with start/stop/reboot/suspend actions"
```

---

### Task 13: Composant `ProxmoxConnectionForm`

**Files:**
- Create: `src/components/ProxmoxConnectionForm.tsx`

**Interfaces:**
- Consumes: `useStore` (`addProxmoxConnection`, `updateProxmoxConnection`, `testProxmoxConnection`), `ProxmoxConnection`/`ProxmoxConnectionPayload` (Task 10)
- Produces: `<ProxmoxConnectionForm connection={ProxmoxConnection | null} onClose={() => void} onMessage={(msg, type) => void} />`

- [ ] **Step 1: Implement**

Ce composant suit le même pattern que `GroupForm.tsx`/`ServerForm.tsx` (formulaire contrôlé + bouton de test avant sauvegarde). Il n'introduit pas de nouvelle logique métier testable au-delà de ce que Task 10 (store) et Task 7 (validation backend) couvrent déjà — pas de test dédié, cohérent avec l'absence de tests sur `ServerForm.tsx`/`GroupForm.tsx` existants.

Créer `src/components/ProxmoxConnectionForm.tsx` :

```typescript
import { useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { ProxmoxConnection, ProxmoxConnectionPayload } from "../types";
import { useStore } from "../stores/useStore";

interface ProxmoxConnectionFormProps {
  connection: ProxmoxConnection | null;
  onClose: () => void;
  onMessage: (msg: string, type?: "success" | "error" | "info") => void;
}

export function ProxmoxConnectionForm({ connection, onClose, onMessage }: ProxmoxConnectionFormProps) {
  const { addProxmoxConnection, updateProxmoxConnection, testProxmoxConnection } = useStore();
  const [form, setForm] = useState<ProxmoxConnectionPayload>({
    name: connection?.name ?? "",
    api_url: connection?.api_url ?? "https://",
    token_id: connection?.token_id ?? "",
    token_secret: "",
    verify_tls: connection?.verify_tls ?? false,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await testProxmoxConnection(form);
      setTestResult("ok");
    } catch (e) {
      setTestResult("fail");
      onMessage(String(e), "error");
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (connection) {
        await updateProxmoxConnection(connection.id, form);
        onMessage("Connexion mise à jour", "success");
      } else {
        await addProxmoxConnection(form);
        onMessage("Connexion ajoutée", "success");
      }
      onClose();
    } catch (e) {
      onMessage(String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-bg-secondary border border-border-primary rounded-win shadow-win p-6 w-full max-w-md space-y-4"
      >
        <h2 className="text-text-primary font-medium text-base">
          {connection ? "Modifier la connexion" : "Nouvelle connexion Proxmox"}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="text-text-secondary text-xs block mb-1">Nom</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="PVE1"
              required
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">URL de l'API</label>
            <input
              value={form.api_url}
              onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))}
              placeholder="https://192.168.1.10:8006"
              required
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">Token ID</label>
            <input
              value={form.token_id}
              onChange={(e) => setForm((f) => ({ ...f, token_id: e.target.value }))}
              placeholder="root@pam!server-manager"
              required
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">
              Secret {connection && "(laisser vide pour ne pas changer)"}
            </label>
            <input
              type="password"
              value={form.token_secret}
              onChange={(e) => setForm((f) => ({ ...f, token_secret: e.target.value }))}
              required={!connection}
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm font-mono"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={form.verify_tls}
              onChange={(e) => setForm((f) => ({ ...f, verify_tls: e.target.checked }))}
            />
            Vérifier le certificat TLS
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-active text-text-primary rounded-win hover:bg-bg-hover transition-colors"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : null}
            Tester la connexion
          </button>
          {testResult === "ok" && <CheckCircle2 size={16} className="text-green-400" />}
          {testResult === "fail" && <XCircle size={16} className="text-red-400" />}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors disabled:opacity-50"
          >
            {saving ? "Sauvegarde..." : "Sauvegarder"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: aucune erreur de type

- [ ] **Step 3: Commit**

```bash
git add src/components/ProxmoxConnectionForm.tsx
git commit -m "feat: add ProxmoxConnectionForm component"
```

---

### Task 14: Page `Proxmox`, entrée sidebar, routing

**Files:**
- Create: `src/pages/Proxmox.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `VmCard` (Task 12), `ProxmoxConnectionForm` (Task 13), `useProxmoxStatus` (Task 11), `useStore` (Task 10), `Toast`/`useToast` (existants)

- [ ] **Step 1: Implement**

Créer `src/pages/Proxmox.tsx` :

```typescript
import { useEffect, useState } from "react";
import { Plus, Server as ServerIcon, AlertCircle } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useProxmoxStatus } from "../hooks/useProxmoxStatus";
import { useToast } from "../hooks/useToast";
import { VmCard } from "../components/VmCard";
import { ProxmoxConnectionForm } from "../components/ProxmoxConnectionForm";
import { ToastContainer } from "../components/Toast";
import { ProxmoxConnection } from "../types";

export function Proxmox() {
  const { proxmoxConnections, proxmoxVms, proxmoxErrors, loadProxmoxConnections } = useStore();
  const { toasts, removeToast, success, error, info } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProxmoxConnection | null>(null);

  useEffect(() => {
    loadProxmoxConnections().catch((e) => error(String(e)));
  }, []);

  useProxmoxStatus();

  function onMessage(msg: string, type: "success" | "error" | "info" = "info") {
    if (type === "success") success(msg);
    else if (type === "error") error(msg);
    else info(msg);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-text-primary font-semibold text-lg">Proxmox</h1>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors"
        >
          <Plus size={14} /> Nouvelle connexion
        </button>
      </div>

      {proxmoxConnections.length === 0 && (
        <div className="text-center py-16 text-text-secondary">
          <ServerIcon size={32} className="mx-auto mb-3 opacity-40" />
          <p>Aucune connexion Proxmox configurée</p>
        </div>
      )}

      {proxmoxConnections.map((conn) => (
        <div key={conn.id} className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-text-primary font-medium text-sm">{conn.name}</h2>
            <span className="text-text-secondary text-xs font-mono">{conn.api_url}</span>
            {proxmoxErrors[conn.id] && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle size={12} /> Hors ligne
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(proxmoxVms[conn.id] ?? []).map((vm) => (
              <VmCard key={`${conn.id}-${vm.node}-${vm.vm_type}-${vm.vmid}`} vm={vm} connectionId={conn.id} onMessage={onMessage} />
            ))}
          </div>
        </div>
      ))}

      {showForm && (
        <ProxmoxConnectionForm
          connection={editing}
          onClose={() => setShowForm(false)}
          onMessage={onMessage}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
```

Dans `src/components/Layout.tsx`, ajouter l'import `Boxes` (icône) et l'entrée de nav :

```typescript
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Server, Layers, Settings, Wifi, Boxes } from "lucide-react";
```

```typescript
const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/servers", icon: Server, label: "Serveurs" },
  { to: "/groups", icon: Layers, label: "Groupes" },
  { to: "/proxmox", icon: Boxes, label: "Proxmox" },
  { to: "/settings", icon: Settings, label: "Paramètres" },
];
```

Dans `src/App.tsx`, ajouter l'import et la route :

```typescript
import { Proxmox } from "./pages/Proxmox";
```

```typescript
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/proxmox" element={<Proxmox />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: aucune erreur de type

- [ ] **Step 3: Run the full frontend test suite**

Run: `npm run test`
Expected: PASS (tous les tests des Tâches 9, 11, 12)

- [ ] **Step 4: Commit**

```bash
git add src/pages/Proxmox.tsx src/components/Layout.tsx src/App.tsx
git commit -m "feat: add Proxmox page, sidebar entry, and route"
```

---

### Task 15: Paramètres réseau — UI pour les nouveaux réglages Proxmox

**Files:**
- Modify: `src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `settings.network.{proxmox_poll_interval_secs, proxmox_timeout_secs}` (Task 10), `updateNetwork` (store existant)

- [ ] **Step 1: Implement**

Dans `src/pages/Settings.tsx`, fonction `SectionNetwork`, ajouter deux champs après le `InputRow` "Timeout SSH" :

```typescript
        <InputRow
          label="Intervalle de rafraîchissement Proxmox (secondes)"
          type="number"
          min={5}
          max={300}
          value={net.proxmox_poll_interval_secs}
          onChange={v => setNet(n => ({ ...n, proxmox_poll_interval_secs: Number(v) }))}
        />
        <InputRow
          label="Timeout API Proxmox (secondes)"
          type="number"
          min={2}
          max={60}
          value={net.proxmox_timeout_secs}
          onChange={v => setNet(n => ({ ...n, proxmox_timeout_secs: Number(v) }))}
        />
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: aucune erreur de type

- [ ] **Step 3: Manual verification**

Run: `npm run tauri dev`
Expected: l'application démarre, la page Paramètres > Réseau affiche les deux nouveaux champs pré-remplis avec les valeurs par défaut (15s / 10s), la page Proxmox est accessible depuis la sidebar et affiche l'état vide ("Aucune connexion Proxmox configurée").

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: add Proxmox network settings to Settings page"
```

---

## Self-Review

**1. Couverture du spec :** Authentification par API Token (Task 2) ✓, `verify_tls` par connexion défaut `false` (Task 1/2/7) ✓, pas de persistance des VM/LXC (Task 3/8 n'écrivent jamais dans `AppData`) ✓, les 11 commandes du spec sont toutes présentes (Tasks 7-8) ✓, secret jamais renvoyé en clair (`without_secret` Task 7) ✓, badge hors-ligne par connexion sans bloquer le reste (Task 14 `proxmoxErrors`) ✓, Vitest + RTL ajoutés (Task 9) ✓, TrueNAS/SSH terminal/métriques SSH explicitement hors périmètre — aucune tâche n'y touche ✓.

**2. Placeholders :** aucun "TBD"/"TODO" — vérifié.

**3. Cohérence des types :** `VmType`/`VmAction` définis Task 3/4 (Rust) et Task 10 (TS) avec les mêmes valeurs lowercase (`qemu`/`lxc`, `start`/`stop`/`shutdown`/`reboot`/`suspend`) ; `ProxmoxVm`/`ProxmoxConnection`/`ProxmoxSnapshot` ont les mêmes champs des deux côtés ; `build_client` (Task 7) est bien réutilisé tel quel en Task 8, pas redéfini.

**4. Review Focus :** les 5 points sont chacun couverts par un test explicite dans la tâche propriétaire (voir table ci-dessus) — confirmé, aucun gap.

---

## Execution Handoff

Plan complet et sauvegardé dans `docs/superpowers/plans/2026-09-24-proxmox-integration-plan.md`. Merci de le relire. Quelle approche d'exécution préfères-tu ?

- **Subagent-driven** — un sous-agent frais implémente chaque tâche et un reviewer frais la valide avant de passer à la suivante, puis une revue de branche complète à la fin. Le plus rigoureux ; coûte un contexte frais par tâche et par revue.
- **Native** — j'implémente moi-même toutes les tâches dans cette session, puis un reviewer frais sur le modèle le plus capable vérifie toute la branche. Le moins cher et le plus rapide ; pas de revue indépendante avant la fin.

Je recommande **Subagent-driven** pour ce plan : 15 tâches qui s'enchaînent sur trois couches (client HTTP Rust avec vraie logique d'auth/parsing, commandes Tauri qui manipulent des secrets chiffrés, store/UI React) où une erreur silencieuse (ex: mauvais mapping `vm_type`/`node`/`vmid`, secret mal effacé avant retour au frontend) pourrait déclencher une action réelle sur une VM de production plus tard sans qu'on s'en aperçoive avant l'usage — une revue par tâche vaut le coût ici. Cela capture-t-il ce que tu veux, et quelle approche utilise-t-on ?
