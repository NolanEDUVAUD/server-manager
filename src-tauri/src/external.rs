/// Ouverture d'adresses externes dans le navigateur par défaut (releases GitHub, rapport
/// de bug, soutien du projet…).
///
/// Remplace `tauri-plugin-shell` : son `open()` est dépassé côté Tauri v2 (remplacé par
/// `tauri-plugin-opener`) et sa restriction `plugins.shell.open` (une regex de
/// configuration) s'est révélée peu fiable avec une adresse encodée très longue (rapport
/// de bug avec de longues informations système). Ici, la seule adresse acceptée est une
/// adresse `https://` vers un hôte de la liste blanche, vérifiée en Rust sur l'URL déjà
/// analysée (host exact, ni identifiants ni mot de passe dans l'URL) : la longueur de la
/// requête ne change rien à la vérification.
use tauri::Url;

const ALLOWED_HOSTS: &[&str] = &["github.com", "ko-fi.com", "www.buymeacoffee.com", "buymeacoffee.com"];

pub const URL_REFUSED_MESSAGE: &str =
    "Adresse refusée : seules les adresses https:// de github.com, ko-fi.com et buymeacoffee.com sont autorisées";

/// Valide `raw` et renvoie l'URL analysée, prête à être transmise à `tauri-plugin-opener`.
pub fn validate_external_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| URL_REFUSED_MESSAGE.to_string())?;
    let host_ok = url.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h));
    let ok = url.scheme() == "https" && host_ok && url.username().is_empty() && url.password().is_none();
    if ok {
        Ok(url)
    } else {
        Err(URL_REFUSED_MESSAGE.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https_to_allowlisted_hosts() {
        for ok in [
            "https://github.com/NolanEDUVAUD/server-manager",
            "https://github.com/NolanEDUVAUD/server-manager/issues/new?title=x&body=y",
            "https://ko-fi.com/whoever",
            "https://www.buymeacoffee.com/whoever",
            "https://buymeacoffee.com/whoever",
        ] {
            assert!(validate_external_url(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn refuses_other_schemes_hosts_or_embedded_credentials() {
        for bad in [
            "http://github.com/",
            "https://evil.com/",
            "https://github.com.evil.com/",
            "https://notgithub.com/",
            "https://user:pass@github.com/",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "not a url",
            "",
        ] {
            assert!(validate_external_url(bad).is_err(), "{bad}");
        }
    }

    /// Le rapport de bug (B4) peut produire une adresse « new issue » très longue une fois
    /// le corps encodé : la validation ne doit dépendre que du schéma et de l'hôte.
    #[test]
    fn accepts_a_very_long_encoded_query() {
        let long = format!(
            "https://github.com/NolanEDUVAUD/server-manager/issues/new?body={}",
            "a".repeat(8000)
        );
        assert!(validate_external_url(&long).is_ok());
    }
}
