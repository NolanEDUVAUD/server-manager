use serde::{Deserialize, Serialize};
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

// ── Paramètres de l'application ────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Intervalle de ping automatique en secondes
    pub ping_interval_secs: u64,
    /// Timeout du ping en millisecondes
    pub ping_timeout_ms: u64,
    /// Timeout SSH en secondes
    pub ssh_timeout_secs: u64,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            ping_interval_secs: 30,
            ping_timeout_ms: 2000,
            ssh_timeout_secs: 30,
        }
    }
}

// ── Données globales de l'application ─────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: AppSettings,
    /// Salt aléatoire pour dériver la clé de chiffrement des mots de passe
    pub encryption_salt: String,
}

impl Default for AppData {
    fn default() -> Self {
        AppData {
            servers: Vec::new(),
            groups: Vec::new(),
            settings: AppSettings::default(),
            encryption_salt: crate::crypto::generate_salt(),
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
