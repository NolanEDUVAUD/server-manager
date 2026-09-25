/// Mise à jour automatique de l'application : logique pure (clé publique embarquée,
/// notes de version, progression du téléchargement), testable sans réseau ni fenêtre.
/// Les commandes Tauri qui s'appuient sur `tauri-plugin-updater` sont dans
/// `commands/app_update.rs`.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::time::Duration;
use tauri::Url;

/// Contenu du fichier versionné `src-tauri/updater-pubkey.txt`, figé à la compilation.
/// Vide tant que le propriétaire n'y a pas mis sa clé publique : mises à jour désactivées.
const EMBEDDED_PUBKEY: &str = include_str!("../updater-pubkey.txt");

/// Taille maximale des notes de version renvoyées à l'interface (en caractères)
pub const MAX_NOTES_CHARS: usize = 4_000;
/// Taille maximale d'un paquet de mise à jour (l'installateur fait une dizaine de Mo)
pub const MAX_PACKAGE_BYTES: u64 = 200 * 1024 * 1024;
/// Longueur maximale d'un numéro de version reçu de l'interface
pub const MAX_VERSION_LEN: usize = 64;
/// Taille maximale d'un message d'erreur renvoyé à l'interface
pub const MAX_ERROR_CHARS: usize = 300;
/// Événement Tauri émis pendant l'installation
pub const PROGRESS_EVENT: &str = "app-update-progress";
/// Pas d'émission de la progression quand la taille totale n'est pas annoncée
const PROGRESS_STEP_UNKNOWN: u64 = 512 * 1024;

pub const NOT_CONFIGURED_MESSAGE: &str =
    "Mises à jour automatiques non configurées pour cette version";

// ── Clé publique ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum PubkeyState {
    /// Fichier vide (ou seulement des commentaires) : fonctionnalité désactivée
    Missing,
    /// Contenu présent mais inutilisable : désactivé aussi, et signalé dans les logs
    Invalid,
    Valid(String),
}

/// Lit la clé publique au format Tauri (base64 du fichier `.pub` de minisign).
/// Lignes vides, blancs et lignes commençant par `#` sont ignorés ; le reste est
/// concaténé sans aucun blanc, car la CLI et le plugin décodent un base64 strict.
pub fn read_pubkey(raw: &str) -> PubkeyState {
    let key: String = raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .flat_map(|l| l.chars().filter(|c| !c.is_whitespace()))
        .collect();
    if key.is_empty() {
        PubkeyState::Missing
    } else if is_minisign_public_key(&key) {
        PubkeyState::Valid(key)
    } else {
        PubkeyState::Invalid
    }
}

/// Clé publique utilisable, ou `None` si les mises à jour sont désactivées
pub fn parse_pubkey(raw: &str) -> Option<String> {
    match read_pubkey(raw) {
        PubkeyState::Valid(key) => Some(key),
        _ => None,
    }
}

pub fn embedded_pubkey_state() -> PubkeyState {
    read_pubkey(EMBEDDED_PUBKEY)
}

pub fn configured_pubkey() -> Option<String> {
    parse_pubkey(EMBEDDED_PUBKEY)
}

/// Une clé publique minisign encodée par Tauri se décode en deux lignes :
/// « untrusted comment: … » puis le base64 de 42 octets (algorithme « Ed »,
/// identifiant de clé sur 8 octets, clé Ed25519 sur 32 octets). Une clé privée
/// collée par erreur (commentaire « secret key », corps bien plus long) est refusée.
fn is_minisign_public_key(key: &str) -> bool {
    let Ok(decoded) = STANDARD.decode(key) else { return false };
    let Ok(text) = String::from_utf8(decoded) else { return false };
    let mut lines = text.lines();
    let (Some(comment), Some(body)) = (lines.next(), lines.next()) else { return false };
    if !comment.starts_with("untrusted comment:") || comment.contains("secret key") {
        return false;
    }
    matches!(STANDARD.decode(body.trim()), Ok(bytes) if bytes.len() == 42 && bytes.starts_with(b"Ed"))
}

// ── Réponse de `app_update_check` ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateCheck {
    /// Clé publique présente : les mises à jour automatiques sont possibles
    pub configured: bool,
    pub available: bool,
    /// Version proposée (si disponible)
    pub version: Option<String>,
    pub current_version: String,
    /// Date de publication (RFC 3339)
    pub date: Option<String>,
    /// Notes de version nettoyées et tronquées, à afficher en texte brut
    pub notes: Option<String>,
}

impl UpdateCheck {
    pub fn not_configured(current_version: &str) -> Self {
        Self {
            configured: false,
            available: false,
            version: None,
            current_version: current_version.to_string(),
            date: None,
            notes: None,
        }
    }

    pub fn up_to_date(current_version: &str) -> Self {
        Self { configured: true, ..Self::not_configured(current_version) }
    }

    pub fn available(current_version: &str, remote: &RemoteUpdate) -> Self {
        Self {
            configured: true,
            available: true,
            version: Some(remote.version.clone()),
            current_version: current_version.to_string(),
            date: remote.date_unix.and_then(format_date),
            notes: sanitize_notes(remote.notes.as_deref()),
        }
    }
}

/// Ce que le manifeste annonce, indépendamment du plugin (testable)
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteUpdate {
    pub version: String,
    pub date_unix: Option<i64>,
    pub notes: Option<String>,
}

/// Recherche une mise à jour. Sans clé publique, répond « non configuré » **sans**
/// appeler `fetch` : aucune requête réseau n'est faite.
pub async fn check_with<F, Fut>(
    pubkey: Option<String>,
    current_version: &str,
    fetch: F,
) -> Result<UpdateCheck, String>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<Option<RemoteUpdate>, String>>,
{
    let Some(key) = pubkey else {
        return Ok(UpdateCheck::not_configured(current_version));
    };
    Ok(match fetch(key).await? {
        Some(remote) => UpdateCheck::available(current_version, &remote),
        None => UpdateCheck::up_to_date(current_version),
    })
}

// ── Adresse du manifeste latest.json ───────────────────────────────────────

/// Identifiant numérique du dépôt GitHub qui publie les releases. L'adresse du
/// manifeste `latest.json` est retrouvée à l'exécution par l'API GitHub : aucune URL
/// portant le nom du compte n'est compilée dans l'application.
pub const GITHUB_REPOSITORY_ID: u64 = 1_387_686_867;
/// Nom du manifeste joint à chaque release signée
pub const MANIFEST_ASSET: &str = "latest.json";
/// Taille maximale de la réponse de l'API GitHub (métadonnées d'une release)
pub const MAX_RELEASE_METADATA_BYTES: usize = 1024 * 1024;

const RESPONSE_TOO_LARGE: &str = "Réponse de GitHub trop volumineuse";
const MANIFEST_URL_REFUSED: &str =
    "Adresse du manifeste refusée : seul un téléchargement de release sur https://github.com est accepté";

/// Dernière release **publiée** du dépôt (ni brouillon ni préversion)
pub fn latest_release_api_url() -> String {
    format!("https://api.github.com/repositories/{GITHUB_REPOSITORY_ID}/releases/latest")
}

#[derive(Deserialize)]
struct ReleaseMetadata {
    #[serde(default)]
    assets: Vec<ReleaseAsset>,
}

#[derive(Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

/// Adresse du manifeste lue dans la réponse de l'API. Seul un téléchargement de
/// release en HTTPS sur github.com est accepté ; le plugin vérifie de toute façon la
/// signature de l'installateur avec la clé publique embarquée.
pub fn manifest_url_from_release(body: &[u8]) -> Result<Url, String> {
    if body.len() > MAX_RELEASE_METADATA_BYTES {
        return Err(RESPONSE_TOO_LARGE.to_string());
    }
    let release: ReleaseMetadata =
        serde_json::from_slice(body).map_err(|e| format!("Réponse de GitHub illisible : {e}"))?;
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == MANIFEST_ASSET)
        .ok_or("La dernière release ne propose pas de mise à jour automatique (latest.json absent)")?;
    let url = Url::parse(&asset.browser_download_url).map_err(|_| MANIFEST_URL_REFUSED.to_string())?;
    let allowed = url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path().contains("/releases/download/")
        && url.path().ends_with("/latest.json");
    if !allowed {
        return Err(MANIFEST_URL_REFUSED.to_string());
    }
    Ok(url)
}

/// Interroge l'API GitHub (`api_url`) et renvoie l'adresse du manifeste de la dernière
/// release. La réponse est lue par morceaux, au plus `MAX_RELEASE_METADATA_BYTES`.
pub async fn fetch_manifest_url(api_url: &str, timeout: Duration) -> Result<Url, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(concat!("server-power-manager/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Client HTTP : {e}"))?;
    let mut resp = client
        .get(api_url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub injoignable : {e}"))?;
    match resp.status() {
        s if s.is_success() => {}
        StatusCode::NOT_FOUND => return Err("Aucune release publiée pour l'instant".to_string()),
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
            return Err("Limite de requêtes de l'API GitHub atteinte : réessaie plus tard".to_string())
        }
        s => return Err(format!("Réponse inattendue de GitHub (HTTP {})", s.as_u16())),
    }
    if resp.content_length().is_some_and(|n| n > MAX_RELEASE_METADATA_BYTES as u64) {
        return Err(RESPONSE_TOO_LARGE.to_string());
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Lecture de la réponse de GitHub : {e}"))? {
        if body.len() + chunk.len() > MAX_RELEASE_METADATA_BYTES {
            return Err(RESPONSE_TOO_LARGE.to_string());
        }
        body.extend_from_slice(&chunk);
    }
    manifest_url_from_release(&body)
}

// ── Validation et nettoyage ────────────────────────────────────────────────

/// Coupe `s` à `max` caractères (jamais au milieu d'un caractère) et ajoute « … »
pub fn truncate_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        None => s.to_string(),
        Some((idx, _)) => format!("{}…", s[..idx].trim_end()),
    }
}

/// Caractères de contrôle de la direction du texte, utilisables pour maquiller
/// l'affichage (texte inversé) : retirés des notes.
fn is_bidi_control(c: char) -> bool {
    matches!(c, '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// Notes de version prêtes à afficher **en texte** : fins de ligne normalisées,
/// caractères de contrôle retirés (sauf saut de ligne et tabulation), longueur bornée.
pub fn sanitize_notes(raw: Option<&str>) -> Option<String> {
    let normalized = raw?.replace("\r\n", "\n").replace('\r', "\n");
    let cleaned: String = normalized
        .chars()
        .filter(|&c| c == '\n' || c == '\t' || !(c.is_control() || is_bidi_control(c)))
        .collect();
    let trimmed = cleaned.trim();
    (!trimmed.is_empty()).then(|| truncate_chars(trimmed, MAX_NOTES_CHARS))
}

/// Date de publication en RFC 3339 (UTC), `None` si hors plage
pub fn format_date(unix: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp(unix, 0).map(|d| d.to_rfc3339())
}

/// Version demandée par l'interface pour l'installation : courte, caractères semver seulement
pub fn validate_version(version: &str) -> Result<(), String> {
    let ok = !version.is_empty()
        && version.len() <= MAX_VERSION_LEN
        && version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    if ok {
        Ok(())
    } else {
        Err("Numéro de version invalide".to_string())
    }
}

/// L'utilisateur installe exactement la version qu'il a vue et confirmée
pub fn ensure_expected_version(expected: &str, pending: Option<&str>) -> Result<(), String> {
    match pending {
        None => Err("Aucune mise à jour en attente : relance la recherche".to_string()),
        Some(v) if v == expected => Ok(()),
        Some(v) => Err(format!(
            "La version proposée a changé ({v}) : vérifie les notes puis relance l'installation"
        )),
    }
}

/// Message d'erreur court pour l'interface
pub fn error_message(context: &str, err: impl std::fmt::Display) -> String {
    truncate_chars(&format!("{context} : {err}"), MAX_ERROR_CHARS)
}

// ── Progression du téléchargement ──────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UpdatePhase {
    Downloading,
    Verifying,
    Installing,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct UpdateProgress {
    pub phase: UpdatePhase,
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PackageTooLarge;

impl std::fmt::Display for PackageTooLarge {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Le paquet de mise à jour dépasse {} Mo : téléchargement interrompu",
            MAX_PACKAGE_BYTES / (1024 * 1024)
        )
    }
}

/// Cumule les octets reçus, refuse un paquet trop gros (annoncé ou reçu) et limite
/// le nombre d'événements envoyés à l'interface : un par pour-cent, ou tous les
/// 512 Kio si la taille totale est inconnue, plus le premier et le dernier morceau.
#[derive(Debug)]
pub struct ProgressTracker {
    max: u64,
    downloaded: u64,
    last_step: Option<u64>,
}

impl ProgressTracker {
    pub fn new(max: u64) -> Self {
        Self { max, downloaded: 0, last_step: None }
    }

    pub fn add(&mut self, chunk: u64, total: Option<u64>) -> Result<Option<UpdateProgress>, PackageTooLarge> {
        self.downloaded = self.downloaded.saturating_add(chunk);
        if self.downloaded > self.max || total.is_some_and(|t| t > self.max) {
            return Err(PackageTooLarge);
        }
        let step = match total {
            Some(t) if t > 0 => self.downloaded.min(t) * 100 / t,
            _ => self.downloaded / PROGRESS_STEP_UNKNOWN,
        };
        let finished = total.is_some_and(|t| self.downloaded >= t);
        if self.last_step == Some(step) && !finished {
            return Ok(None);
        }
        self.last_step = Some(step);
        Ok(Some(UpdateProgress { phase: UpdatePhase::Downloading, downloaded: self.downloaded, total }))
    }

    pub fn downloaded(&self) -> u64 {
        self.downloaded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Clé publique d'exemple de la documentation Tauri (publique par nature)
    const SAMPLE_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE5QzMxNjYwNTM5OEUwNTgKUldSWTRKaFRZQmJER1h4d1ZMYVA3dnluSjdpN2RmMldJR09hUFFlZDY0SlFqckkvRUJhZDJVZXAK";

    fn b64(s: &str) -> String {
        STANDARD.encode(s)
    }

    // ── Clé publique ──

    #[test]
    fn empty_comments_or_blank_pubkey_disables_updates() {
        for raw in ["", "   ", "\n\n", "# Clé publique de signature\n", "  # commentaire\r\n\t\n"] {
            assert_eq!(read_pubkey(raw), PubkeyState::Missing, "{raw:?}");
            assert_eq!(parse_pubkey(raw), None);
        }
    }

    #[test]
    fn valid_pubkey_enables_updates() {
        assert_eq!(parse_pubkey(SAMPLE_PUBKEY).as_deref(), Some(SAMPLE_PUBKEY));
        // Commentaires, blancs, CRLF et saut de ligne final tolérés
        let messy = format!("# Clé de release\r\n\n  {SAMPLE_PUBKEY}  \r\n");
        assert_eq!(parse_pubkey(&messy).as_deref(), Some(SAMPLE_PUBKEY));
        // Clé coupée sur plusieurs lignes par un éditeur : recollée
        let (a, b) = SAMPLE_PUBKEY.split_at(40);
        assert_eq!(parse_pubkey(&format!("{a}\n{b}\n")).as_deref(), Some(SAMPLE_PUBKEY));
    }

    #[test]
    fn invalid_pubkey_is_rejected() {
        assert_eq!(read_pubkey("pas du base64 !"), PubkeyState::Invalid);
        assert_eq!(read_pubkey(&b64("juste du texte")), PubkeyState::Invalid);
        // Bon commentaire mais corps de mauvaise taille
        assert_eq!(read_pubkey(&b64("untrusted comment: minisign public key: 00\nRWQ=\n")), PubkeyState::Invalid);
    }

    #[test]
    fn private_key_pasted_by_mistake_is_rejected() {
        let body = STANDARD.encode([0x45u8; 158]);
        let secret = b64(&format!("untrusted comment: rsign encrypted secret key\n{body}\n"));
        assert_eq!(read_pubkey(&secret), PubkeyState::Invalid);
        // Même avec un corps de 42 octets, le commentaire « secret key » suffit à refuser
        let short = STANDARD.encode([b'E', b'd'].iter().chain([0u8; 40].iter()).copied().collect::<Vec<_>>());
        let secret = b64(&format!("untrusted comment: rsign encrypted secret key\n{short}\n"));
        assert_eq!(read_pubkey(&secret), PubkeyState::Invalid);
    }

    #[test]
    fn shipped_pubkey_file_is_never_a_private_key() {
        let decoded = STANDARD
            .decode(EMBEDDED_PUBKEY.split_whitespace().collect::<String>())
            .map(|d| String::from_utf8_lossy(&d).to_lowercase())
            .unwrap_or_default();
        assert!(!decoded.contains("secret key"));
        assert!(!EMBEDDED_PUBKEY.to_lowercase().contains("secret key"));
        assert_ne!(embedded_pubkey_state(), PubkeyState::Invalid, "updater-pubkey.txt est illisible");
    }

    // ── Notes ──

    #[test]
    fn notes_are_truncated_on_a_char_boundary() {
        let long = "é".repeat(MAX_NOTES_CHARS + 10);
        let notes = sanitize_notes(Some(&long)).unwrap();
        assert_eq!(notes.chars().count(), MAX_NOTES_CHARS + 1);
        assert!(notes.ends_with('…'));
        let exact = "a".repeat(MAX_NOTES_CHARS);
        assert_eq!(sanitize_notes(Some(&exact)).unwrap(), exact);
    }

    #[test]
    fn notes_are_cleaned_but_kept_as_plain_text() {
        let raw = "\r\n  ## Nouveautés\r\n- <b>Gras</b> & <script>x</script>\u{0007}\u{202E}\tfin\r  ";
        let notes = sanitize_notes(Some(raw)).unwrap();
        // Le HTML n'est pas interprété ici : l'interface l'affiche tel quel, en texte
        assert_eq!(notes, "## Nouveautés\n- <b>Gras</b> & <script>x</script>\tfin");
        assert_eq!(sanitize_notes(None), None);
        assert_eq!(sanitize_notes(Some(" \r\n\u{0000} ")), None);
    }

    #[test]
    fn date_is_rfc3339() {
        assert_eq!(format_date(0).as_deref(), Some("1970-01-01T00:00:00+00:00"));
        assert_eq!(format_date(i64::MAX), None);
    }

    // ── Réponse ──

    #[test]
    fn update_check_serialization() {
        let remote = RemoteUpdate {
            version: "0.3.0".into(),
            date_unix: Some(1_790_000_000),
            notes: Some("Corrections\r\n".into()),
        };
        let json = serde_json::to_value(UpdateCheck::available("0.2.0", &remote)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "configured": true,
                "available": true,
                "version": "0.3.0",
                "current_version": "0.2.0",
                "date": "2026-09-21T14:13:20+00:00",
                "notes": "Corrections"
            })
        );
        let json = serde_json::to_value(UpdateCheck::not_configured("0.2.0")).unwrap();
        assert_eq!(json["configured"], false);
        assert_eq!(json["available"], false);
        assert!(json["version"].is_null() && json["notes"].is_null() && json["date"].is_null());
        assert_eq!(serde_json::to_value(UpdateCheck::up_to_date("0.2.0")).unwrap()["configured"], true);
    }

    #[tokio::test]
    async fn check_without_pubkey_never_touches_the_network() {
        let called = std::sync::atomic::AtomicBool::new(false);
        let r = check_with(None, "0.2.0", |_key| {
            called.store(true, std::sync::atomic::Ordering::SeqCst);
            async { Ok(None) }
        })
        .await
        .unwrap();
        assert!(!called.load(std::sync::atomic::Ordering::SeqCst), "aucune requête sans clé publique");
        assert_eq!(r, UpdateCheck::not_configured("0.2.0"));
        // Clé embarquée vide (état livré) : même comportement
        assert_eq!(configured_pubkey(), parse_pubkey(EMBEDDED_PUBKEY));
    }

    #[tokio::test]
    async fn check_with_pubkey_reports_available_up_to_date_or_error() {
        let key = Some(SAMPLE_PUBKEY.to_string());
        let r = check_with(key.clone(), "0.2.0", |k| async move {
            assert_eq!(k, SAMPLE_PUBKEY);
            Ok(Some(RemoteUpdate { version: "0.3.0".into(), date_unix: None, notes: None }))
        })
        .await
        .unwrap();
        assert!(r.available && r.configured);
        assert_eq!(r.version.as_deref(), Some("0.3.0"));

        let r = check_with(key.clone(), "0.2.0", |_| async { Ok(None) }).await.unwrap();
        assert_eq!(r, UpdateCheck::up_to_date("0.2.0"));

        let e = check_with(key, "0.2.0", |_| async { Err("hors ligne".to_string()) }).await.unwrap_err();
        assert_eq!(e, "hors ligne");
    }

    // ── Adresse du manifeste ──

    const MANIFEST: &str = "https://github.com/owner/server-manager/releases/download/v0.4.0/latest.json";

    fn release_json(manifest_url: &str) -> String {
        serde_json::json!({
            "tag_name": "v0.4.0",
            "assets": [
                { "name": "Server.Power.Manager_0.4.0_x64-setup.exe", "browser_download_url": "https://github.com/owner/server-manager/releases/download/v0.4.0/Server.Power.Manager_0.4.0_x64-setup.exe" },
                { "name": "latest.json", "browser_download_url": manifest_url }
            ]
        })
        .to_string()
    }

    #[test]
    fn api_url_uses_the_numeric_repository_id() {
        let url = latest_release_api_url();
        let id = url
            .strip_prefix("https://api.github.com/repositories/")
            .and_then(|rest| rest.strip_suffix("/releases/latest"))
            .expect(&url);
        assert!(!id.is_empty() && id.chars().all(|c| c.is_ascii_digit()), "{url}");
    }

    #[test]
    fn manifest_url_is_read_from_the_latest_release() {
        let url = manifest_url_from_release(release_json(MANIFEST).as_bytes()).unwrap();
        assert_eq!(url.as_str(), MANIFEST);
    }

    #[test]
    fn manifest_url_outside_github_releases_is_refused() {
        for bad in [
            "http://github.com/owner/server-manager/releases/download/v0.4.0/latest.json",
            "https://example.com/owner/server-manager/releases/download/v0.4.0/latest.json",
            "https://github.com.example.com/owner/server-manager/releases/download/v0.4.0/latest.json",
            "https://github.com:8443/owner/server-manager/releases/download/v0.4.0/latest.json",
            "https://user@github.com/owner/server-manager/releases/download/v0.4.0/latest.json",
            "https://github.com/owner/server-manager/raw/master/latest.json",
            "https://github.com/owner/server-manager/releases/download/v0.4.0/latest.json?x=1",
            "https://github.com/owner/server-manager/releases/download/v0.4.0/latest.json.exe",
            "pas une adresse",
        ] {
            let err = manifest_url_from_release(release_json(bad).as_bytes()).unwrap_err();
            assert_eq!(err, MANIFEST_URL_REFUSED, "{bad}");
        }
    }

    #[test]
    fn release_without_manifest_or_unreadable_is_an_error() {
        let no_manifest = serde_json::json!({ "assets": [{ "name": "setup.exe", "browser_download_url": MANIFEST }] });
        assert!(manifest_url_from_release(no_manifest.to_string().as_bytes()).unwrap_err().contains("latest.json absent"));
        assert!(manifest_url_from_release(b"{}").unwrap_err().contains("latest.json absent"));
        assert!(manifest_url_from_release(b"{\"assets\": 5}").unwrap_err().starts_with("Réponse de GitHub illisible"));
        assert!(manifest_url_from_release(b"<html>").unwrap_err().starts_with("Réponse de GitHub illisible"));
        let huge = vec![b' '; MAX_RELEASE_METADATA_BYTES + 1];
        assert_eq!(manifest_url_from_release(&huge).unwrap_err(), RESPONSE_TOO_LARGE);
    }

    #[tokio::test]
    async fn fetch_reads_the_manifest_url_from_the_api() {
        use wiremock::matchers::{header, header_exists, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/repositories/1/releases/latest"))
            .and(header("accept", "application/vnd.github+json"))
            .and(header_exists("user-agent"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(release_json(MANIFEST), "application/json"))
            .expect(1)
            .mount(&server)
            .await;
        let api = format!("{}/repositories/1/releases/latest", server.uri());
        let url = fetch_manifest_url(&api, Duration::from_secs(5)).await.unwrap();
        assert_eq!(url.as_str(), MANIFEST);
    }

    #[tokio::test]
    async fn fetch_refuses_failed_or_oversized_responses() {
        use wiremock::matchers::path;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let huge = format!("{{\"padding\": \"{}\"}}", "x".repeat(MAX_RELEASE_METADATA_BYTES));
        for (route, response) in [
            ("/none", ResponseTemplate::new(404)),
            ("/limited", ResponseTemplate::new(403)),
            ("/broken", ResponseTemplate::new(500)),
            ("/huge", ResponseTemplate::new(200).set_body_raw(huge, "application/json")),
        ] {
            Mock::given(path(route)).respond_with(response).mount(&server).await;
        }
        let uri = server.uri();
        let err = |route: &str| {
            let url = format!("{uri}{route}");
            async move { fetch_manifest_url(&url, Duration::from_secs(5)).await.unwrap_err() }
        };
        assert!(err("/none").await.contains("Aucune release publiée"));
        assert!(err("/limited").await.contains("Limite de requêtes"));
        assert!(err("/broken").await.contains("HTTP 500"));
        assert_eq!(err("/huge").await, RESPONSE_TOO_LARGE);
    }

    // ── Version et erreurs ──

    #[test]
    fn version_validation() {
        for ok in ["0.3.0", "1.0.0-beta.1", "2.0.0+build.5"] {
            assert!(validate_version(ok).is_ok(), "{ok}");
        }
        for bad in ["", "0.3.0 ; rm -rf", "../0.3.0", "v0.3.0/..", &"1".repeat(MAX_VERSION_LEN + 1)] {
            assert!(validate_version(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn install_requires_the_confirmed_version() {
        assert!(ensure_expected_version("0.3.0", Some("0.3.0")).is_ok());
        assert!(ensure_expected_version("0.3.0", Some("0.4.0")).unwrap_err().contains("0.4.0"));
        assert!(ensure_expected_version("0.3.0", None).is_err());
    }

    #[test]
    fn error_messages_are_bounded() {
        let msg = error_message("Échec", "x".repeat(10_000));
        assert!(msg.starts_with("Échec : x"));
        assert_eq!(msg.chars().count(), MAX_ERROR_CHARS + 1);
    }

    // ── Progression ──

    #[test]
    fn progress_is_throttled_to_one_event_per_percent() {
        let mut t = ProgressTracker::new(MAX_PACKAGE_BYTES);
        let total = Some(10_000);
        let events: Vec<_> = (0..100).filter_map(|_| t.add(100, total).unwrap()).collect();
        // Premier morceau (1 %) puis un événement par pour-cent jusqu'à 100 %
        assert_eq!(events.len(), 100);
        assert_eq!(events.last().unwrap().downloaded, 10_000);
        assert!(events.iter().all(|e| e.phase == UpdatePhase::Downloading));

        let mut t = ProgressTracker::new(MAX_PACKAGE_BYTES);
        let events = (0..1000).filter_map(|_| t.add(10, total).unwrap()).count();
        assert_eq!(events, 101, "0 %, puis 1 % … 100 %");
    }

    #[test]
    fn progress_without_total_uses_fixed_steps() {
        let mut t = ProgressTracker::new(MAX_PACKAGE_BYTES);
        let events = (0..64).filter_map(|_| t.add(64 * 1024, None).unwrap()).count();
        // 4 Mio reçus par morceaux de 64 Kio : un événement tous les 512 Kio, plus le premier
        assert_eq!(events, 9);
        assert_eq!(t.downloaded(), 4 * 1024 * 1024);
    }

    #[test]
    fn oversized_package_is_refused() {
        let mut t = ProgressTracker::new(1_000);
        assert_eq!(t.add(10, Some(5_000)), Err(PackageTooLarge));
        let mut t = ProgressTracker::new(1_000);
        assert!(t.add(600, None).is_ok());
        assert_eq!(t.add(600, None), Err(PackageTooLarge));
        assert!(PackageTooLarge.to_string().contains("200 Mo"));
    }

    #[test]
    fn progress_serialization() {
        let p = UpdateProgress { phase: UpdatePhase::Verifying, downloaded: 5, total: None };
        assert_eq!(
            serde_json::to_value(p).unwrap(),
            serde_json::json!({ "phase": "verifying", "downloaded": 5, "total": null })
        );
    }
}

/// Garde-fous sur la configuration Tauri et le workflow de release
#[cfg(test)]
mod config_tests {
    const BASE: &str = include_str!("../tauri.conf.json");
    const RELEASE: &str = include_str!("../tauri.release.conf.json");
    const WORKFLOW: &str = include_str!("../../.github/workflows/release.yml");

    fn json(s: &str) -> serde_json::Value {
        serde_json::from_str(s).expect("configuration JSON invalide")
    }

    /// Marqueurs d'une clé privée minisign, en clair ou encodée en base64 par Tauri
    fn contains_private_key(s: &str) -> bool {
        let lower = s.to_lowercase();
        lower.contains("secret key")
            || lower.contains("private key")
            // base64 de « untrusted comment: rsign encrypted secret key »
            || s.contains("dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5")
            || s.contains("TAURI_SIGNING_PRIVATE_KEY")
    }

    #[test]
    fn base_config_has_no_private_key_nor_updater_artifacts() {
        assert!(!contains_private_key(BASE));
        let base = json(BASE);
        // Build local sans clé : pas d'artefacts de mise à jour (donc pas de signature exigée)
        assert_ne!(base["bundle"]["createUpdaterArtifacts"], serde_json::json!(true));
        assert!(base["bundle"].get("createUpdaterArtifacts").is_none());

        let updater = &base["plugins"]["updater"];
        assert_eq!(updater["pubkey"], "", "la clé publique vient de updater-pubkey.txt");
        assert_eq!(updater["windows"]["installMode"], "passive");
        // L'adresse du manifeste est retrouvée à l'exécution (GITHUB_REPOSITORY_ID) : aucune
        // URL portant le nom du compte n'est compilée dans le binaire
        assert!(updater.get("endpoints").is_none());
        for config in [BASE, RELEASE] {
            assert!(!config.contains("github.com"), "aucune adresse GitHub dans la configuration compilée");
        }
        for danger in ["dangerousInsecureTransportProtocol", "dangerousAcceptInvalidCerts", "dangerousAcceptInvalidHostnames", "allowDowngrades"] {
            assert!(updater.get(danger).is_none(), "{danger} ne doit pas être activé");
        }
    }

    #[test]
    fn release_config_enables_signed_updater_artifacts() {
        assert!(!contains_private_key(RELEASE));
        let release = json(RELEASE);
        assert_eq!(release["bundle"]["createUpdaterArtifacts"], serde_json::json!(true));
        // La CLI lit la clé publique dans ce fichier (chemin relatif à src-tauri)
        assert_eq!(release["plugins"]["updater"]["pubkey"], "updater-pubkey.txt");
        assert!(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("updater-pubkey.txt").is_file());
    }

    #[test]
    fn release_workflow_signs_with_secrets_and_creates_a_draft() {
        assert!(WORKFLOW.contains("--config src-tauri/tauri.release.conf.json"));
        assert!(WORKFLOW.contains("TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}"));
        assert!(WORKFLOW.contains("TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}"));
        assert!(WORKFLOW.contains("releaseDraft: true"));
        assert!(WORKFLOW.contains("contents: write"));
        assert!(WORKFLOW.contains("SHA256SUMS.txt"));
        assert!(!WORKFLOW.to_lowercase().contains("secret key"));
    }
}
