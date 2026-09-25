/// Coffre de la clé maître : Gestionnaire d'identification Windows (via `keyring`)
use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::Entry;

use crate::crypto::generate_key;

const SERVICE: &str = "com.homelab.server-manager";
const ACCOUNT: &str = "master-key";

/// Lit la clé maître, ou en crée une nouvelle si elle n'existe pas encore.
pub fn load_or_create_master_key() -> Result<[u8; 32], String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Coffre indisponible : {}", e))?;
    match entry.get_password() {
        Ok(b64) => {
            let bytes = STANDARD.decode(b64.trim()).map_err(|e| format!("Clé maître illisible : {}", e))?;
            bytes.try_into().map_err(|_| "Clé maître de taille invalide".to_string())
        }
        Err(keyring::Error::NoEntry) => {
            let key = generate_key();
            entry
                .set_password(&STANDARD.encode(key))
                .map_err(|e| format!("Impossible d'enregistrer la clé maître : {}", e))?;
            // Relecture : on ne migre rien tant que la clé n'est pas réellement récupérable
            let stored = entry.get_password().map_err(|e| format!("Clé maître non relisible : {}", e))?;
            if STANDARD.decode(stored.trim()).ok().as_deref() != Some(&key[..]) {
                return Err("La clé maître relue ne correspond pas".into());
            }
            log::info!("Clé maître créée dans le Gestionnaire d'identification Windows");
            Ok(key)
        }
        Err(e) => Err(format!("Lecture de la clé maître impossible : {}", e)),
    }
}
