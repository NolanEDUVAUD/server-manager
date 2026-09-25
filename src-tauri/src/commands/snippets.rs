/// Commandes SSH mémorisées (insérées dans le terminal, jamais exécutées d'office)
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::storage::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub command: String,
}

/// Commandes proposées au premier lancement, toutes en lecture seule
pub fn default_snippets() -> Vec<Snippet> {
    [
        ("Invités Proxmox (VM)", "qm list"),
        ("Invités Proxmox (CT)", "pct list"),
        ("État du cluster", "pvecm status"),
        ("Pools ZFS", "zpool status"),
        ("Espace disque", "df -h"),
        ("Mémoire", "free -h"),
        ("Conteneurs Docker", "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'"),
        ("Services en échec", "systemctl --failed"),
        ("Erreurs depuis le démarrage", "journalctl -p err -b --no-pager | tail -50"),
        ("Mises à jour disponibles", "apt list --upgradable 2>/dev/null"),
    ]
    .into_iter()
    .map(|(name, command)| Snippet { id: Uuid::new_v4().to_string(), name: name.into(), command: command.into() })
    .collect()
}

#[tauri::command]
pub fn get_snippets(state: State<AppState>) -> Result<Vec<Snippet>, String> {
    Ok(state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?.snippets.clone())
}

#[tauri::command]
pub fn save_snippet(state: State<AppState>, mut snippet: Snippet) -> Result<Snippet, String> {
    if snippet.name.trim().is_empty() || snippet.command.trim().is_empty() {
        return Err("Nom et commande requis".into());
    }
    if snippet.command.contains('\n') {
        return Err("Une seule ligne par commande".into());
    }
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        match data.snippets.iter_mut().find(|s| s.id == snippet.id && !snippet.id.is_empty()) {
            Some(existing) => *existing = snippet.clone(),
            None => {
                snippet.id = Uuid::new_v4().to_string();
                data.snippets.push(snippet.clone());
            }
        }
    }
    state.save()?;
    Ok(snippet)
}

#[tauri::command]
pub fn delete_snippet(state: State<AppState>, id: String) -> Result<(), String> {
    state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?.snippets.retain(|s| s.id != id);
    state.save()
}

#[cfg(test)]
mod tests {
    #[test]
    fn defaults_are_single_line_and_read_only() {
        for s in super::default_snippets() {
            assert!(!s.command.contains('\n'));
            // Aucune commande par défaut ne doit modifier le système
            for danger in ["rm ", "shutdown", "reboot", "stop", "destroy", "apt upgrade", "apt install"] {
                assert!(!s.command.contains(danger), "{} contient {}", s.command, danger);
            }
        }
    }
}
