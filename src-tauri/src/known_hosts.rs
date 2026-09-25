/// Empreintes des clés d'hôte SSH (confiance à la première connexion, comme ~/.ssh/known_hosts)
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, PartialEq, Eq)]
pub enum Trust {
    /// Premier contact : l'empreinte vient d'être mémorisée
    New,
    Match,
    /// L'empreinte a changé depuis la dernière connexion : serveur réinstallé… ou usurpé
    Mismatch { expected: String },
}

/// Magasin pur (testable) : hôte « ip:port » → empreinte SHA256
#[derive(Default)]
pub struct KnownHosts {
    hosts: HashMap<String, String>,
}

impl KnownHosts {
    pub fn check(&mut self, host: &str, fingerprint: &str) -> Trust {
        match self.hosts.get(host) {
            None => {
                self.hosts.insert(host.to_string(), fingerprint.to_string());
                Trust::New
            }
            Some(known) if known == fingerprint => Trust::Match,
            Some(known) => Trust::Mismatch { expected: known.clone() },
        }
    }

    pub fn forget(&mut self, host: &str) -> bool {
        self.hosts.remove(host).is_some()
    }
}

// ── Instance globale persistée dans known_hosts.json ──────────────────────
struct Store {
    inner: Mutex<KnownHosts>,
    path: PathBuf,
}

static STORE: OnceLock<Store> = OnceLock::new();

pub fn init(path: PathBuf) {
    let hosts = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let _ = STORE.set(Store { inner: Mutex::new(KnownHosts { hosts }), path });
}

fn save(store: &Store, hosts: &KnownHosts) {
    if let Ok(json) = serde_json::to_string_pretty(&hosts.hosts) {
        if let Err(e) = std::fs::write(&store.path, json) {
            log::warn!("Écriture de known_hosts impossible : {}", e);
        }
    }
}

/// Vérifie l'empreinte d'un hôte. Sans magasin initialisé (tests), tout est refusé.
pub fn verify(host: &str, fingerprint: &str) -> Trust {
    let Some(store) = STORE.get() else {
        return Trust::Mismatch { expected: "magasin non initialisé".into() };
    };
    let Ok(mut hosts) = store.inner.lock() else {
        return Trust::Mismatch { expected: "magasin verrouillé".into() };
    };
    let trust = hosts.check(host, fingerprint);
    if trust == Trust::New {
        log::info!("Nouvelle clé d'hôte SSH mémorisée pour {} : SHA256:{}", host, fingerprint);
        save(store, &hosts);
    }
    trust
}

/// Oublie l'empreinte d'un hôte (serveur réinstallé volontairement)
pub fn forget(host: &str) -> Result<bool, String> {
    let store = STORE.get().ok_or("Magasin de clés d'hôte non initialisé")?;
    let mut hosts = store.inner.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let removed = hosts.forget(host);
    save(store, &hosts);
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_on_first_use_then_detect_change() {
        let mut kh = KnownHosts::default();
        assert_eq!(kh.check("10.0.0.1:22", "AAA"), Trust::New);
        assert_eq!(kh.check("10.0.0.1:22", "AAA"), Trust::Match);
        assert_eq!(kh.check("10.0.0.1:22", "BBB"), Trust::Mismatch { expected: "AAA".into() });
        // Le port fait partie de l'identité de l'hôte
        assert_eq!(kh.check("10.0.0.1:2222", "BBB"), Trust::New);
    }

    #[test]
    fn forget_allows_a_new_key() {
        let mut kh = KnownHosts::default();
        kh.check("h:22", "AAA");
        assert!(kh.forget("h:22"));
        assert_eq!(kh.check("h:22", "BBB"), Trust::New);
        assert!(!kh.forget("absent:22"));
    }

    #[test]
    fn uninitialized_store_refuses() {
        assert!(matches!(verify("x:22", "AAA"), Trust::Mismatch { .. }));
    }
}
