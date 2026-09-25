use crate::proxmox::models::ProxmoxConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ── Types OS supportés ─────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum OsType {
    #[default]
    Linux,
    Windows,
    Proxmox,
    TrueNAS,
    ESXi,
}

impl OsType {
    /// Commande d'arrêt par défaut selon l'OS
    pub fn default_shutdown_command(&self) -> &'static str {
        match self {
            OsType::Linux => "sudo shutdown -h now",
            OsType::Windows => "shutdown /s /t 0",
            OsType::Proxmox => "shutdown -h now",
            OsType::TrueNAS => "shutdown -p now",
            OsType::ESXi => "poweroff",
        }
    }

    /// Commande de redémarrage par défaut selon l'OS
    pub fn default_reboot_command(&self) -> &'static str {
        match self {
            OsType::Linux => "sudo reboot",
            OsType::Windows => "shutdown /r /t 0",
            OsType::Proxmox => "reboot",
            OsType::TrueNAS => "reboot",
            OsType::ESXi => "reboot",
        }
    }
}

// ── Serveur ────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub mac_address: String,
    pub ssh_user: String,
    /// Mot de passe chiffré en AES-256-GCM, encodé en base64
    pub ssh_password: String,
    pub ssh_port: u16,
    pub shutdown_command: String,
    pub reboot_command: String,
    pub os_type: OsType,
    pub icon: Option<String>,
    pub notes: Option<String>,
}

impl Server {
    pub fn new(
        name: String,
        ip: String,
        mac_address: String,
        ssh_user: String,
        ssh_password_encrypted: String,
        ssh_port: u16,
        os_type: OsType,
        icon: Option<String>,
        notes: Option<String>,
    ) -> Self {
        let shutdown_command = os_type.default_shutdown_command().to_string();
        let reboot_command = os_type.default_reboot_command().to_string();
        Server {
            id: Uuid::new_v4().to_string(),
            name,
            ip,
            mac_address,
            ssh_user,
            ssh_password: ssh_password_encrypted,
            ssh_port,
            shutdown_command,
            reboot_command,
            os_type,
            icon,
            notes,
        }
    }
}

// ── Payload pour créer/modifier un serveur (reçu depuis le frontend) ───────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerPayload {
    pub name: String,
    pub ip: String,
    pub mac_address: String,
    pub ssh_user: String,
    /// Mot de passe en clair (sera chiffré côté Rust)
    pub ssh_password: String,
    pub ssh_port: u16,
    pub shutdown_command: Option<String>,
    pub reboot_command: Option<String>,
    pub os_type: OsType,
    pub icon: Option<String>,
    pub notes: Option<String>,
}

// ── Groupe ─────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub server_ids: Vec<String>,
    pub icon: Option<String>,
}

impl Group {
    pub fn new(name: String, icon: Option<String>) -> Self {
        Group {
            id: Uuid::new_v4().to_string(),
            name,
            server_ids: Vec::new(),
            icon,
        }
    }
}

// ─── Thème ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub builtin: bool,
    pub colors: HashMap<String, String>,
}

// ─── Density ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub enum Density {
    Compact,
    #[default]
    Normal,
    Comfortable,
}

// ─── AppSettings v2 ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneralSettings {
    pub start_minimized: bool,
    pub auto_start: bool,
    pub notifications: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self { start_minimized: false, auto_start: false, notifications: true }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppearanceSettings {
    pub brightness: f32,
    pub font_size: u8,
    pub density: Density,
    pub active_theme: String,
    pub custom_themes: Vec<Theme>,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            brightness: 1.0,
            font_size: 14,
            density: Density::Normal,
            active_theme: "one-half-dark".to_string(),
            custom_themes: vec![],
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkSettings {
    pub ping_interval_secs: u64,
    pub ping_timeout_ms: u64,
    pub ssh_timeout_secs: u64,
    #[serde(default = "default_proxmox_poll_interval")]
    pub proxmox_poll_interval_secs: u64,
    #[serde(default = "default_proxmox_timeout")]
    pub proxmox_timeout_secs: u64,
    #[serde(default = "default_metrics_enabled")]
    pub metrics_enabled: bool,
    #[serde(default = "default_metrics_interval")]
    pub metrics_interval_secs: u64,
}

fn default_proxmox_poll_interval() -> u64 {
    15
}

fn default_proxmox_timeout() -> u64 {
    10
}

fn default_metrics_enabled() -> bool {
    true
}

fn default_metrics_interval() -> u64 {
    15
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self {
            ping_interval_secs: 30,
            ping_timeout_ms: 2000,
            ssh_timeout_secs: 30,
            proxmox_poll_interval_secs: default_proxmox_poll_interval(),
            proxmox_timeout_secs: default_proxmox_timeout(),
            metrics_enabled: default_metrics_enabled(),
            metrics_interval_secs: default_metrics_interval(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub appearance: AppearanceSettings,
    pub network: NetworkSettings,
}

impl AppSettings {
    /// Crée les paramètres v2 à partir des paramètres v1 (migration)
    pub fn from_v1(v1: AppSettingsV1) -> Self {
        Self {
            general: GeneralSettings::default(),
            appearance: AppearanceSettings::default(),
            network: NetworkSettings {
                ping_interval_secs: v1.ping_interval_secs,
                ping_timeout_ms: v1.ping_timeout_ms,
                ssh_timeout_secs: v1.ssh_timeout_secs,
                proxmox_poll_interval_secs: default_proxmox_poll_interval(),
                proxmox_timeout_secs: default_proxmox_timeout(),
            metrics_enabled: default_metrics_enabled(),
            metrics_interval_secs: default_metrics_interval(),
            },
        }
    }
}

// ─── Format v1 pour migration ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AppSettingsV1 {
    pub ping_interval_secs: u64,
    pub ping_timeout_ms: u64,
    pub ssh_timeout_secs: u64,
}

#[derive(Debug, Deserialize)]
pub struct AppDataV1 {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: AppSettingsV1,
    pub encryption_salt: String,
}

// ─── PendingImport ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingImport {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: Option<AppSettings>,
    pub config_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportSummary {
    pub servers_count: usize,
    pub groups_count: usize,
    pub settings_present: bool,
    pub config_version: String,
    pub exported_at: Option<String>,
}

// ── Données globales de l'application ─────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: AppSettings,
    /// Salt aléatoire pour dériver la clé de chiffrement des mots de passe
    pub encryption_salt: String,
    #[serde(default)]
    pub proxmox_connections: Vec<ProxmoxConnection>,
    #[serde(default)]
    pub schedules: Vec<crate::scheduler::Schedule>,
    /// Schéma de la clé de chiffrement des secrets (voir crypto::KEY_VERSION_MASTER)
    #[serde(default = "legacy_key_version")]
    pub key_version: u8,
}

fn legacy_key_version() -> u8 {
    1
}

impl Default for AppData {
    fn default() -> Self {
        AppData {
            servers: Vec::new(),
            groups: Vec::new(),
            settings: AppSettings::default(),
            encryption_salt: crate::crypto::generate_salt(),
            proxmox_connections: Vec::new(),
            schedules: Vec::new(),
            key_version: 1,
        }
    }
}

// ── Résultat de ping renvoyé au frontend ───────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub server_id: String,
    pub online: bool,
    pub latency_ms: Option<u64>,
}

// ── Résultat d'action SSH ──────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrate_v1_settings_preserves_network() {
        let v1 = AppSettingsV1 {
            ping_interval_secs: 60,
            ping_timeout_ms: 3000,
            ssh_timeout_secs: 45,
        };
        let v2 = AppSettings::from_v1(v1);
        assert_eq!(v2.network.ping_interval_secs, 60);
        assert_eq!(v2.network.ping_timeout_ms, 3000);
        assert_eq!(v2.network.ssh_timeout_secs, 45);
        assert_eq!(v2.appearance.active_theme, "one-half-dark");
        assert!(!v2.general.start_minimized);
        assert!(v2.general.notifications);
    }

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.network.ping_interval_secs, 30);
        assert_eq!(settings.appearance.font_size, 14);
        assert_eq!(settings.appearance.active_theme, "one-half-dark");
    }

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
}
