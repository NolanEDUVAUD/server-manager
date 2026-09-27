/// Commandes Tauri — Apparence de la fenêtre (barre de titre aux couleurs du thème)
use tauri::AppHandle;

/// Couleur « #rrggbb » (ou « #rgb ») → (r, g, b). Toute autre forme est refusée.
pub(crate) fn parse_hex_color(value: &str) -> Option<(u8, u8, u8)> {
    let hex = value.trim().strip_prefix('#')?;
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let expand = |c: &str| u8::from_str_radix(&c.repeat(2), 16).ok();
    match hex.len() {
        6 => Some((
            u8::from_str_radix(&hex[0..2], 16).ok()?,
            u8::from_str_radix(&hex[2..4], 16).ok()?,
            u8::from_str_radix(&hex[4..6], 16).ok()?,
        )),
        3 => Some((expand(&hex[0..1])?, expand(&hex[1..2])?, expand(&hex[2..3])?)),
        _ => None,
    }
}

/// Valeur COLORREF de Windows : 0x00BBGGRR
pub(crate) fn colorref((r, g, b): (u8, u8, u8)) -> u32 {
    u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16)
}

/// Aligne la barre de titre native (et ses boutons réduire / agrandir / fermer) sur le
/// thème : couleur de fond, couleur du texte et bordure sous Windows 11, simple mode
/// clair/sombre sous Windows 10 (qui ignore les couleurs personnalisées). Garder la barre
/// native conserve l'ancrage, les dispositions d'ancrage et le double-clic.
/// Sans effet hors Windows.
#[tauri::command]
pub fn set_titlebar_colors(app: AppHandle, background: String, text: String, dark: bool) -> Result<(), String> {
    let bg = parse_hex_color(&background).ok_or("Couleur de fond invalide")?;
    let fg = parse_hex_color(&text).ok_or("Couleur de texte invalide")?;
    platform::apply(&app, bg, fg, dark)
}

#[cfg(windows)]
mod platform {
    use tauri::{AppHandle, Manager};
    use windows::Win32::Foundation::{COLORREF, HWND};
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    pub fn apply(app: &AppHandle, bg: (u8, u8, u8), fg: (u8, u8, u8), dark: bool) -> Result<(), String> {
        let window = app.get_webview_window("main").ok_or("Fenêtre principale introuvable")?;
        let hwnd: HWND = window.hwnd().map_err(|e| format!("Fenêtre principale : {}", e))?;
        let dark_flag: i32 = i32::from(dark);
        let caption = COLORREF(super::colorref(bg));
        let text = COLORREF(super::colorref(fg));
        // SAFETY : hwnd est la fenêtre principale vivante ; chaque attribut reçoit un
        // pointeur vers une valeur locale de la taille annoncée.
        unsafe {
            // Windows 10 (1809+) : barre claire ou sombre, les couleurs ci-dessous n'y existent pas
            let _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark_flag as *const i32 as *const _, 4);
            // Windows 11 (22000+) : couleurs exactes du thème ; ignorées (erreur) sur les versions antérieures
            let _ = DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, &caption as *const COLORREF as *const _, 4);
            let _ = DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &caption as *const COLORREF as *const _, 4);
            let _ = DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, &text as *const COLORREF as *const _, 4);
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::AppHandle;

    pub fn apply(_app: &AppHandle, _bg: (u8, u8, u8), _fg: (u8, u8, u8), _dark: bool) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_colors_are_parsed_strictly() {
        assert_eq!(parse_hex_color("#1e2127"), Some((0x1e, 0x21, 0x27)));
        assert_eq!(parse_hex_color(" #FFF "), Some((255, 255, 255)));
        assert_eq!(parse_hex_color("#abc"), Some((0xaa, 0xbb, 0xcc)));
        for bad in ["", "1e2127", "#12345", "#gggggg", "rgb(1,2,3)", "#1e2127ff", "#+12345"] {
            assert_eq!(parse_hex_color(bad), None, "{bad}");
        }
    }

    #[test]
    fn colorref_is_bgr() {
        assert_eq!(colorref((0x12, 0x34, 0x56)), 0x0056_3412);
    }
}
