//! Extensions communautaires (F1) : manifeste JSON déclaratif uniquement — jamais
//! de code exécuté. Le schéma complet (types, longueurs, regex) est validé côté
//! frontend (`src/utils/extensions.ts`), seul à connaître le détail du format ; ce
//! module ne fait que stocker le manifeste validé et border ce qui touche au
//! système : taille des fichiers/réponses HTTP, et lecture/écriture disque.
use std::time::Duration;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::models::AppData;
use crate::storage::AppState;

/// Taille maximale acceptée pour un fichier ou une réponse HTTP d'extension (256 Ko)
pub const MAX_EXTENSION_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstalledExtension {
    /// Manifeste tel que validé côté frontend (voir `src/utils/extensions.ts`)
    pub manifest: serde_json::Value,
    pub enabled: bool,
}

fn manifest_id(manifest: &serde_json::Value) -> Option<&str> {
    manifest.get("id").and_then(|v| v.as_str())
}

/// Installe (ou met à jour, même id) une extension déjà validée par le frontend.
pub fn install(data: &mut AppData, manifest: serde_json::Value) -> Result<InstalledExtension, String> {
    let serialized = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    if serialized.len() > MAX_EXTENSION_BYTES {
        return Err("Manifeste trop volumineux (> 256 Ko)".into());
    }
    let id = manifest_id(&manifest)
        .filter(|s| !s.trim().is_empty())
        .ok_or("Manifeste sans identifiant valide")?
        .to_string();
    let installed = InstalledExtension { manifest, enabled: true };
    data.extensions.retain(|e| manifest_id(&e.manifest) != Some(id.as_str()));
    data.extensions.push(installed.clone());
    Ok(installed)
}

pub fn set_enabled(data: &mut AppData, id: &str, enabled: bool) -> Result<(), String> {
    match data.extensions.iter_mut().find(|e| manifest_id(&e.manifest) == Some(id)) {
        Some(e) => {
            e.enabled = enabled;
            Ok(())
        }
        None => Err("Extension introuvable".into()),
    }
}

pub fn uninstall(data: &mut AppData, id: &str) {
    data.extensions.retain(|e| manifest_id(&e.manifest) != Some(id));
}

#[tauri::command]
pub fn get_extensions(state: State<AppState>) -> Result<Vec<InstalledExtension>, String> {
    Ok(state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?.extensions.clone())
}

#[tauri::command]
pub fn install_extension(state: State<AppState>, manifest: serde_json::Value) -> Result<InstalledExtension, String> {
    let installed = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        install(&mut data, manifest)?
    };
    state.save()?;
    Ok(installed)
}

#[tauri::command]
pub fn set_extension_enabled(state: State<AppState>, id: String, enabled: bool) -> Result<(), String> {
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        set_enabled(&mut data, &id, enabled)?;
    }
    state.save()
}

#[tauri::command]
pub fn uninstall_extension(state: State<AppState>, id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        uninstall(&mut data, &id);
    }
    state.save()
}

/// Lit un fichier local choisi via la boîte de dialogue (« Installer depuis un fichier »).
/// Limité en taille : un manifeste d'extension n'a aucune raison de dépasser 256 Ko.
#[tauri::command]
pub fn read_extension_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Fichier introuvable : {}", e))?;
    if meta.len() > MAX_EXTENSION_BYTES as u64 {
        return Err("Fichier trop volumineux (> 256 Ko)".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Lecture impossible : {}", e))?;
    String::from_utf8(bytes).map_err(|_| "Le fichier n'est pas de l'UTF-8 valide".to_string())
}

/// Télécharge un manifeste depuis une URL (« Installer depuis une URL »). La CSP du
/// frontend bloque déjà `fetch()` vers une origine distante : le téléchargement passe
/// donc par cette commande Rust, en HTTPS uniquement et de taille bornée (le flux est
/// lu par morceaux : un en-tête `Content-Length` mensonger ne permet pas de dépasser
/// la limite).
#[tauri::command]
pub async fn fetch_extension_manifest(url: String) -> Result<String, String> {
    let url = url.trim();
    if !url.starts_with("https://") {
        return Err("Seules les URL en https:// sont autorisées".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| format!("Client HTTP : {}", e))?;
    let resp = client.get(url).send().await.map_err(|e| format!("Téléchargement impossible : {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Le serveur a répondu {}", resp.status()));
    }
    if resp.content_length().is_some_and(|len| len > MAX_EXTENSION_BYTES as u64) {
        return Err("Fichier trop volumineux (> 256 Ko)".into());
    }
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Téléchargement interrompu : {}", e))?;
        buf.extend_from_slice(&chunk);
        if buf.len() > MAX_EXTENSION_BYTES {
            return Err("Fichier trop volumineux (> 256 Ko)".into());
        }
    }
    String::from_utf8(buf).map_err(|_| "Le fichier n'est pas de l'UTF-8 valide".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest(id: &str) -> serde_json::Value {
        json!({ "id": id, "name": "Démo", "version": "1.0.0", "author": "quelqu'un", "description": "Une extension de démo" })
    }

    #[test]
    fn install_rejects_manifest_without_id() {
        let mut data = AppData::default();
        let err = install(&mut data, json!({ "name": "x" })).unwrap_err();
        assert!(err.contains("identifiant"));
    }

    #[test]
    fn install_rejects_oversized_manifest() {
        let mut data = AppData::default();
        let big = "x".repeat(MAX_EXTENSION_BYTES + 1);
        let err = install(&mut data, json!({ "id": "com.example.big", "padding": big })).unwrap_err();
        assert!(err.contains("volumineux"));
    }

    #[test]
    fn install_same_id_replaces_previous_entry() {
        let mut data = AppData::default();
        install(&mut data, manifest("com.example.demo")).unwrap();
        assert_eq!(data.extensions.len(), 1);
        let mut updated = manifest("com.example.demo");
        updated["version"] = json!("2.0.0");
        install(&mut data, updated).unwrap();
        assert_eq!(data.extensions.len(), 1, "même id : mise à jour, pas doublon");
        assert_eq!(data.extensions[0].manifest["version"], json!("2.0.0"));
    }

    #[test]
    fn set_enabled_and_uninstall() {
        let mut data = AppData::default();
        install(&mut data, manifest("com.example.demo")).unwrap();
        assert!(data.extensions[0].enabled);

        set_enabled(&mut data, "com.example.demo", false).unwrap();
        assert!(!data.extensions[0].enabled);
        assert!(set_enabled(&mut data, "inconnu", true).is_err());

        uninstall(&mut data, "com.example.demo");
        assert!(data.extensions.is_empty());
    }

    #[test]
    fn read_extension_file_rejects_oversized_file() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("ext-test-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, "x".repeat(MAX_EXTENSION_BYTES + 1)).unwrap();
        let err = read_extension_file(path.to_string_lossy().to_string()).unwrap_err();
        std::fs::remove_file(&path).ok();
        assert!(err.contains("volumineux"));
    }

    #[test]
    fn read_extension_file_returns_content_within_limit() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("ext-test-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&path, r#"{"id":"com.example.demo"}"#).unwrap();
        let content = read_extension_file(path.to_string_lossy().to_string()).unwrap();
        std::fs::remove_file(&path).ok();
        assert!(content.contains("com.example.demo"));
    }
}
