/// Commande Tauri — Ouverture d'une adresse externe dans le navigateur par défaut.
///
/// La webview n'a accès à aucune permission du plugin `tauri-plugin-opener` : elle ne peut
/// appeler que cette commande, qui valide l'adresse (voir `crate::external`) avant de la
/// transmettre au plugin.
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::external::validate_external_url;

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|e| format!("Impossible d'ouvrir le navigateur : {e}"))
}
