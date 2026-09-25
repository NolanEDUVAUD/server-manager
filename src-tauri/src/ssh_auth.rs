/// Résolution unique des paramètres de connexion SSH d'un serveur : hôte, port, utilisateur,
/// méthode d'authentification (secret déchiffré au dernier moment) et hôte de rebond éventuel.
use std::fmt;
use zeroize::Zeroizing;

use crate::{
    crypto,
    models::{AppData, AuthMethod, Server},
    ssh_keys,
};

/// Moyen de s'authentifier ; les secrets sont effacés de la mémoire à la destruction
#[derive(Clone)]
pub enum SshAuth {
    Password(Zeroizing<String>),
    /// Clé privée OpenSSH en clair (relue par russh au moment de l'authentification)
    Key(Zeroizing<String>),
    /// Agent SSH de la machine : aucun secret côté app
    Agent,
}

/// Cible d'une connexion SSH, avec son rebond éventuel (un seul niveau)
#[derive(Clone)]
pub struct SshTarget {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
    pub jump: Option<Box<SshTarget>>,
}

impl SshTarget {
    /// Même cible (et même rebond), authentifiée autrement : vérification d'une clé déployée
    pub fn with_auth(&self, auth: SshAuth) -> SshTarget {
        SshTarget { auth, ..self.clone() }
    }
}

/// `Debug` écrit à la main : la méthode apparaît, jamais le secret
impl fmt::Debug for SshAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            SshAuth::Password(_) => "Password(***)",
            SshAuth::Key(_) => "Key(***)",
            SshAuth::Agent => "Agent",
        })
    }
}

impl fmt::Debug for SshTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SshTarget")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("auth", &self.auth)
            .field("jump", &self.jump)
            .finish()
    }
}

fn find<'a>(data: &'a AppData, id: &str) -> Option<&'a Server> {
    data.servers.iter().find(|s| s.id == id)
}

/// Identifiant de rebond renseigné (une chaîne vide venue du formulaire vaut « aucun »)
pub fn jump_id(server: &Server) -> Option<&str> {
    server.jump_host_id.as_deref().filter(|id| !id.is_empty())
}

/// Vérifie qu'un rebond est utilisable pour `server_id` : existant, pas lui-même, sans cycle et
/// sans second niveau. Utilisé à l'enregistrement et à la connexion.
pub fn check_jump(data: &AppData, server_id: &str, server_name: &str, jump_host_id: &str) -> Result<(), String> {
    if jump_host_id == server_id {
        return Err(format!("{} ne peut pas être son propre hôte de rebond", server_name));
    }
    let jump = find(data, jump_host_id)
        .ok_or_else(|| format!("L'hôte de rebond de {} n'existe plus : choisis-en un autre ou connexion directe", server_name))?;
    match jump_id(jump) {
        None => {}
        Some(j) if j == server_id => {
            return Err(format!("Boucle de rebond : {} et {} passent l'un par l'autre", server_name, jump.name))
        }
        Some(_) => {
            return Err(format!(
                "{} passe lui-même par un rebond : un seul niveau de rebond est pris en charge",
                jump.name
            ))
        }
    }
    // Le serveur choisi comme rebond ne doit pas être utilisé comme rebond par d'autres serveurs
    // si lui-même en a un : garanti par la règle ci-dessus appliquée à chacun.
    Ok(())
}

/// Authentification propre d'un serveur, sans rebond
fn direct_target(data: &AppData, server: &Server) -> Result<SshTarget, String> {
    let auth = match server.auth_method {
        AuthMethod::Password => {
            let key = crypto::data_key(data)?;
            SshAuth::Password(Zeroizing::new(crypto::decrypt(&server.ssh_password, &key)?))
        }
        AuthMethod::Key => {
            let key_id = server
                .ssh_key_id
                .as_deref()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| format!("Aucune clé SSH choisie pour {} : modifie le serveur", server.name))?;
            let ssh_key = data.ssh_keys.iter().find(|k| k.id == key_id).ok_or_else(|| {
                format!(
                    "La clé SSH de {} a été supprimée : choisis une autre clé ou une autre méthode d'authentification",
                    server.name
                )
            })?;
            let master = crypto::data_key(data)?;
            SshAuth::Key(ssh_keys::decrypt_private_key(ssh_key, &master)?)
        }
        AuthMethod::Agent => SshAuth::Agent,
    };
    Ok(SshTarget { host: server.ip.clone(), port: server.ssh_port, user: server.ssh_user.clone(), auth, jump: None })
}

/// Paramètres de connexion complets d'un serveur (rebond compris)
pub fn resolve_ssh(data: &AppData, server_id: &str) -> Result<SshTarget, String> {
    let server = find(data, server_id).ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
    let mut target = direct_target(data, server)?;
    if let Some(jump_id) = jump_id(server) {
        check_jump(data, &server.id, &server.name, jump_id)?;
        let jump = find(data, jump_id).ok_or_else(|| format!("Hôte de rebond introuvable pour {}", server.name))?;
        let jump_target = direct_target(data, jump).map_err(|e| format!("Hôte de rebond {} : {}", jump.name, e))?;
        target.jump = Some(Box::new(jump_target));
    }
    Ok(target)
}

/// Serveurs qui passent par `server_id` comme hôte de rebond
pub fn jump_dependents(data: &AppData, server_id: &str) -> Vec<String> {
    data.servers.iter().filter(|s| jump_id(s) == Some(server_id)).map(|s| s.name.clone()).collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::models::OsType;

    /// Données de test : clé maître « legacy » (dérivée du sel), comme avant la migration
    pub(crate) fn server(data: &AppData, id: &str, name: &str, ip: &str, password: &str) -> Server {
        let key = crypto::data_key(data).unwrap();
        let mut s = Server::new(
            name.into(), ip.into(), String::new(), "root".into(), crypto::encrypt(password, &key).unwrap(), 22, OsType::Linux, None, None,
        );
        s.id = id.into();
        s
    }

    fn fixture() -> AppData {
        let mut data = AppData::default();
        let master = crypto::data_key(&data).unwrap();
        let (key, _) = crate::ssh_keys::tests::sealed_key("minipc", &master);
        data.ssh_keys.push(key);
        let a = server(&data, "a", "minipc", "192.168.1.10", "s3cret");
        let mut b = server(&data, "b", "DockerHost", "192.168.1.20", "");
        b.auth_method = AuthMethod::Key;
        b.ssh_key_id = Some("id-minipc".into());
        let mut c = server(&data, "c", "Workstation", "192.168.1.30", "");
        c.auth_method = AuthMethod::Agent;
        data.servers.extend([a, b, c]);
        data
    }

    #[test]
    fn password_key_and_agent_resolve_to_the_right_auth() {
        let data = fixture();
        let a = resolve_ssh(&data, "a").unwrap();
        assert_eq!((a.host.as_str(), a.port, a.user.as_str()), ("192.168.1.10", 22, "root"));
        assert!(matches!(&a.auth, SshAuth::Password(p) if p.as_str() == "s3cret"));
        assert!(a.jump.is_none());

        let b = resolve_ssh(&data, "b").unwrap();
        assert!(matches!(&b.auth, SshAuth::Key(pem) if pem.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----")));
        assert!(matches!(resolve_ssh(&data, "c").unwrap().auth, SshAuth::Agent));
        assert!(resolve_ssh(&data, "absent").unwrap_err().contains("introuvable"));
    }

    #[test]
    fn jump_host_resolves_with_its_own_auth() {
        let mut data = fixture();
        data.servers[1].jump_host_id = Some("a".into());
        let b = resolve_ssh(&data, "b").unwrap();
        assert!(matches!(b.auth, SshAuth::Key(_)));
        let jump = b.jump.expect("rebond");
        assert_eq!(jump.host, "192.168.1.10");
        assert!(matches!(&jump.auth, SshAuth::Password(p) if p.as_str() == "s3cret"));
        assert!(jump.jump.is_none());
        assert_eq!(jump_dependents(&data, "a"), vec!["DockerHost".to_string()]);
        // Une chaîne vide venue du formulaire = connexion directe
        data.servers[1].jump_host_id = Some(String::new());
        assert!(resolve_ssh(&data, "b").unwrap().jump.is_none());
    }

    #[test]
    fn invalid_jumps_are_refused() {
        let mut data = fixture();
        data.servers[0].jump_host_id = Some("supprimé".into());
        assert!(resolve_ssh(&data, "a").unwrap_err().contains("n'existe plus"));

        data.servers[0].jump_host_id = Some("a".into());
        assert!(resolve_ssh(&data, "a").unwrap_err().contains("propre hôte de rebond"));

        // Cycle a → b → a
        data.servers[0].jump_host_id = Some("b".into());
        data.servers[1].jump_host_id = Some("a".into());
        assert!(resolve_ssh(&data, "a").unwrap_err().contains("Boucle"));

        // Deux niveaux : a → b → c
        data.servers[1].jump_host_id = Some("c".into());
        assert!(resolve_ssh(&data, "a").unwrap_err().contains("un seul niveau"));
    }

    #[test]
    fn deleted_or_missing_key_gives_a_clear_error() {
        let mut data = fixture();
        data.ssh_keys.clear();
        assert!(resolve_ssh(&data, "b").unwrap_err().contains("a été supprimée"));
        data.servers[1].ssh_key_id = None;
        assert!(resolve_ssh(&data, "b").unwrap_err().contains("Aucune clé SSH choisie"));
        // Un rebond dont la clé est supprimée : l'erreur nomme le rebond
        data.servers[0].jump_host_id = Some("b".into());
        assert!(resolve_ssh(&data, "a").unwrap_err().starts_with("Hôte de rebond DockerHost"));
    }

    #[test]
    fn debug_never_shows_secrets() {
        let mut data = fixture();
        data.servers[1].jump_host_id = Some("a".into());
        let target = resolve_ssh(&data, "b").unwrap();
        let dbg = format!("{:?}", target);
        assert!(dbg.contains("Key(***)") && dbg.contains("Password(***)"), "{}", dbg);
        assert!(!dbg.contains("s3cret") && !dbg.contains("OPENSSH"), "{}", dbg);
    }
}
