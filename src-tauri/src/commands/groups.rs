/// Commandes Tauri — CRUD des groupes de serveurs
use tauri::State;

use crate::{
    models::Group,
    storage::AppState,
};

// ── Récupérer tous les groupes ────────────────────────────────────────────
#[tauri::command]
pub fn get_groups(state: State<AppState>) -> Result<Vec<Group>, String> {
    let data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.groups.clone())
}

// ── Créer un groupe ───────────────────────────────────────────────────────
#[tauri::command]
pub fn add_group(
    state: State<AppState>,
    name: String,
    icon: Option<String>,
) -> Result<Group, String> {
    if name.trim().is_empty() {
        return Err("Le nom du groupe est requis".to_string());
    }

    let group = Group::new(name.trim().to_string(), icon);
    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    data.groups.push(group.clone());
    drop(data);

    state.save()?;
    log::info!("Groupe créé : {}", group.name);
    Ok(group)
}

// ── Modifier un groupe ────────────────────────────────────────────────────
#[tauri::command]
pub fn update_group(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    server_ids: Option<Vec<String>>,
    icon: Option<String>,
) -> Result<Group, String> {
    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    // Valider les server_ids avant de mutater (évite les conflits de borrow)
    let valid_ids: Option<Vec<String>> = server_ids.map(|ids| {
        let known: Vec<&str> = data.servers.iter().map(|s| s.id.as_str()).collect();
        ids.into_iter().filter(|sid| known.contains(&sid.as_str())).collect()
    });

    let group = data
        .groups
        .iter_mut()
        .find(|g| g.id == id)
        .ok_or_else(|| format!("Groupe introuvable: {}", id))?;

    if let Some(n) = name {
        if !n.trim().is_empty() {
            group.name = n.trim().to_string();
        }
    }
    if let Some(ids) = valid_ids {
        group.server_ids = ids;
    }
    // icon = None signifie "pas de changement", Some("") signifie "supprimer"
    if let Some(ic) = icon {
        group.icon = if ic.is_empty() { None } else { Some(ic) };
    }

    let updated = group.clone();
    drop(data);

    state.save()?;
    log::info!("Groupe mis à jour : {}", updated.name);
    Ok(updated)
}

// ── Ajouter/retirer un serveur d'un groupe ────────────────────────────────
#[tauri::command]
pub fn toggle_server_in_group(
    state: State<AppState>,
    group_id: String,
    server_id: String,
) -> Result<Group, String> {
    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    // Vérifier que le serveur existe
    if !data.servers.iter().any(|s| s.id == server_id) {
        return Err(format!("Serveur introuvable: {}", server_id));
    }

    let group = data
        .groups
        .iter_mut()
        .find(|g| g.id == group_id)
        .ok_or_else(|| format!("Groupe introuvable: {}", group_id))?;

    if group.server_ids.contains(&server_id) {
        group.server_ids.retain(|id| id != &server_id);
        log::info!("Serveur {} retiré du groupe {}", server_id, group.name);
    } else {
        group.server_ids.push(server_id.clone());
        log::info!("Serveur {} ajouté au groupe {}", server_id, group.name);
    }

    let updated = group.clone();
    drop(data);

    state.save()?;
    Ok(updated)
}

// ── Supprimer un groupe ───────────────────────────────────────────────────
#[tauri::command]
pub fn delete_group(state: State<AppState>, id: String) -> Result<(), String> {
    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    let len_before = data.groups.len();
    data.groups.retain(|g| g.id != id);

    if data.groups.len() == len_before {
        return Err(format!("Groupe introuvable: {}", id));
    }

    drop(data);
    state.save()?;
    log::info!("Groupe supprimé : {}", id);
    Ok(())
}
