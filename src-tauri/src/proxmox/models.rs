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
pub struct ProxmoxNode {
    pub node: String,
    pub status: String,
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
            "https://192.168.50.10:8006".to_string(),
            "root@pam!sm".to_string(),
            "encrypted-secret".to_string(),
            false,
        );
        let c2 = ProxmoxConnection::new(
            "PVE2".to_string(),
            "https://192.168.50.11:8006".to_string(),
            "root@pam!sm".to_string(),
            "encrypted-secret".to_string(),
            true,
        );
        assert_ne!(c1.id, c2.id);
        assert_eq!(c1.name, "PVE1");
        assert_eq!(c1.api_url, "https://192.168.50.10:8006");
        assert!(!c1.verify_tls);
        assert!(c2.verify_tls);
    }
}
