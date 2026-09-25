/// Commandes Tauri — Organisation : tags, dossiers et favoris des serveurs et des services
use tauri::State;

use crate::{
    models::AppData,
    organisation::{self, Folder, ItemKind, Organisation, Tag},
    storage::AppState,
};

/// Applique une modification sous verrou, puis sauvegarde si elle a réussi
fn mutate<T>(state: &AppState, f: impl FnOnce(&mut AppData) -> Result<T, String>) -> Result<T, String> {
    let result = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        f(&mut data)?
    };
    state.save()?;
    Ok(result)
}

#[tauri::command]
pub fn get_organisation(state: State<AppState>) -> Result<Organisation, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(Organisation { tags: data.tags.clone(), folders: data.folders.clone() })
}

/// Crée (id vide) ou modifie un tag
#[tauri::command]
pub fn save_tag(state: State<AppState>, tag: Tag) -> Result<Tag, String> {
    let saved = mutate(&state, |d| organisation::save_tag(d, tag))?;
    log::info!("Tag enregistré : {}", saved.name);
    Ok(saved)
}

/// Supprime un tag et le retire de tous les serveurs et services
#[tauri::command]
pub fn delete_tag(state: State<AppState>, id: String) -> Result<(), String> {
    mutate(&state, |d| organisation::delete_tag(d, &id))?;
    log::info!("Tag supprimé : {}", id);
    Ok(())
}

/// Crée (id vide) ou renomme un dossier
#[tauri::command]
pub fn save_folder(state: State<AppState>, folder: Folder) -> Result<Folder, String> {
    let saved = mutate(&state, |d| organisation::save_folder(d, folder))?;
    log::info!("Dossier enregistré : {}", saved.name);
    Ok(saved)
}

/// Supprime un dossier : ses éléments passent « sans dossier »
#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> Result<(), String> {
    mutate(&state, |d| organisation::delete_folder(d, &id))?;
    log::info!("Dossier supprimé : {}", id);
    Ok(())
}

/// Bascule le favori d'un serveur (`server`) ou d'un service (`probe`) ; renvoie le nouvel état
#[tauri::command]
pub fn toggle_favorite(state: State<AppState>, kind: ItemKind, id: String) -> Result<bool, String> {
    mutate(&state, |d| organisation::toggle_favorite(d, kind, &id))
}
