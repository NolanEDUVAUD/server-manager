//! Organisation des serveurs et des services : tags colorés, dossiers (un seul niveau),
//! favoris et champs personnalisés.
//!
//! Rien ici n'est secret : ces données voyagent dans les exports de configuration.
//! Toutes les entrées (formulaires, imports) sont revalidées ici, et les références
//! (identifiants de tags et de dossiers) sont toujours assainies : un identifiant
//! inconnu est ignoré plutôt que de laisser une référence orpheline.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::models::{AppData, Server, ServerPayload};

pub const TAG_NAME_MAX: usize = 32;
pub const FOLDER_NAME_MAX: usize = 40;
pub const MAX_TAGS: usize = 200;
pub const MAX_FOLDERS: usize = 100;
pub const CUSTOM_KEY_MAX: usize = 40;
pub const CUSTOM_VALUE_MAX: usize = 500;
pub const MAX_CUSTOM_FIELDS: usize = 20;
/// Longueur maximale d'un identifiant importé (au-delà, un nouvel identifiant est généré)
const ID_MAX: usize = 64;

// ── Modèle ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tag {
    /// Vide à la création (généré côté Rust)
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// Couleur « #rrggbb »
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Folder {
    /// Vide à la création (généré côté Rust)
    #[serde(default)]
    pub id: String,
    pub name: String,
}

/// Information libre d'un serveur (emplacement, numéro de série…). Non chiffrée.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CustomField {
    pub key: String,
    #[serde(default)]
    pub value: String,
}

/// Type d'élément organisable
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Server,
    Probe,
}

/// Tags et dossiers, renvoyés ensemble au frontend
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Organisation {
    pub tags: Vec<Tag>,
    pub folders: Vec<Folder>,
}

// ── Validation ────────────────────────────────────────────────────────────

/// Nom affichable : espaces de bord retirés, 1 à `max` caractères, sans caractère de contrôle
fn clean_name(raw: &str, max: usize, what: &str) -> Result<String, String> {
    let name = raw.trim();
    let len = name.chars().count();
    if len == 0 {
        return Err(format!("Le nom du {} est requis", what));
    }
    if len > max {
        return Err(format!("Nom du {} trop long ({} caractères au plus)", what, max));
    }
    if name.chars().any(char::is_control) {
        return Err(format!("Nom du {} invalide (caractère de contrôle)", what));
    }
    Ok(name.to_string())
}

/// Couleur « #rrggbb », renvoyée en minuscules
pub fn validate_color(raw: &str) -> Result<String, String> {
    raw.trim()
        .strip_prefix('#')
        .filter(|h| h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|h| format!("#{}", h.to_ascii_lowercase()))
        .ok_or_else(|| "Couleur invalide (format attendu #rrggbb, ex. #3b82f6)".to_string())
}

/// Comparaison de noms sans tenir compte de la casse (Unicode)
fn same_name(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

fn clean_custom_field(f: CustomField) -> Result<CustomField, String> {
    let key = f.key.trim().to_string();
    let value = f.value.trim().to_string();
    let key_len = key.chars().count();
    if key_len == 0 {
        return Err("La clé d'un champ personnalisé est requise".into());
    }
    if key_len > CUSTOM_KEY_MAX {
        return Err(format!("Clé de champ personnalisé trop longue ({} caractères au plus)", CUSTOM_KEY_MAX));
    }
    if value.chars().count() > CUSTOM_VALUE_MAX {
        return Err(format!("Valeur de « {} » trop longue ({} caractères au plus)", key, CUSTOM_VALUE_MAX));
    }
    if key.chars().chain(value.chars()).any(char::is_control) {
        return Err(format!("Champ « {} » : caractère de contrôle interdit", key));
    }
    Ok(CustomField { key, value })
}

/// Champs personnalisés saisis dans le formulaire : tout ou rien, avec un message clair
pub fn validate_custom_fields(fields: Vec<CustomField>) -> Result<Vec<CustomField>, String> {
    if fields.len() > MAX_CUSTOM_FIELDS {
        return Err(format!("{} champs personnalisés au plus", MAX_CUSTOM_FIELDS));
    }
    let mut seen = HashSet::new();
    fields
        .into_iter()
        .map(|f| {
            let f = clean_custom_field(f)?;
            if !seen.insert(f.key.to_lowercase()) {
                return Err(format!("Clé « {} » en double", f.key));
            }
            Ok(f)
        })
        .collect()
}

/// Champs personnalisés importés (non fiables) : les invalides et les doublons sont écartés
pub fn sanitize_custom_fields(fields: Vec<CustomField>) -> Vec<CustomField> {
    let mut seen = HashSet::new();
    fields
        .into_iter()
        .filter_map(|f| clean_custom_field(f).ok())
        .filter(|f| seen.insert(f.key.to_lowercase()))
        .take(MAX_CUSTOM_FIELDS)
        .collect()
}

/// Garde les tags connus, sans doublon, dans l'ordre reçu
pub fn clean_tag_ids(tags: &[Tag], ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.into_iter()
        .filter(|id| tags.iter().any(|t| &t.id == id) && seen.insert(id.clone()))
        .collect()
}

/// Dossier connu, sinon « sans dossier »
pub fn clean_folder_id(folders: &[Folder], id: Option<String>) -> Option<String> {
    id.filter(|f| folders.iter().any(|x| &x.id == f))
}

// ── Tags ──────────────────────────────────────────────────────────────────

/// Crée (id vide) ou modifie un tag
pub fn save_tag(data: &mut AppData, tag: Tag) -> Result<Tag, String> {
    let name = clean_name(&tag.name, TAG_NAME_MAX, "tag")?;
    let color = validate_color(&tag.color)?;
    let id = tag.id.trim();
    if data.tags.iter().any(|t| t.id != id && same_name(&t.name, &name)) {
        return Err(format!("Un tag « {} » existe déjà", name));
    }
    if id.is_empty() {
        if data.tags.len() >= MAX_TAGS {
            return Err(format!("{} tags au plus", MAX_TAGS));
        }
        let created = Tag { id: Uuid::new_v4().to_string(), name, color };
        data.tags.push(created.clone());
        return Ok(created);
    }
    let existing = data.tags.iter_mut().find(|t| t.id == id).ok_or("Tag introuvable")?;
    existing.name = name;
    existing.color = color;
    Ok(existing.clone())
}

/// Supprime un tag et le retire de tous les serveurs et services
pub fn delete_tag(data: &mut AppData, id: &str) -> Result<(), String> {
    let before = data.tags.len();
    data.tags.retain(|t| t.id != id);
    if data.tags.len() == before {
        return Err("Tag introuvable".into());
    }
    for s in data.servers.iter_mut() {
        s.tag_ids.retain(|t| t != id);
    }
    for p in data.probes.iter_mut() {
        p.tag_ids.retain(|t| t != id);
    }
    Ok(())
}

// ── Dossiers ──────────────────────────────────────────────────────────────

/// Crée (id vide) ou renomme un dossier
pub fn save_folder(data: &mut AppData, folder: Folder) -> Result<Folder, String> {
    let name = clean_name(&folder.name, FOLDER_NAME_MAX, "dossier")?;
    let id = folder.id.trim();
    if data.folders.iter().any(|f| f.id != id && same_name(&f.name, &name)) {
        return Err(format!("Un dossier « {} » existe déjà", name));
    }
    if id.is_empty() {
        if data.folders.len() >= MAX_FOLDERS {
            return Err(format!("{} dossiers au plus", MAX_FOLDERS));
        }
        let created = Folder { id: Uuid::new_v4().to_string(), name };
        data.folders.push(created.clone());
        return Ok(created);
    }
    let existing = data.folders.iter_mut().find(|f| f.id == id).ok_or("Dossier introuvable")?;
    existing.name = name;
    Ok(existing.clone())
}

/// Supprime un dossier : ses serveurs et services passent « sans dossier » (ils ne sont pas supprimés)
pub fn delete_folder(data: &mut AppData, id: &str) -> Result<(), String> {
    let before = data.folders.len();
    data.folders.retain(|f| f.id != id);
    if data.folders.len() == before {
        return Err("Dossier introuvable".into());
    }
    for s in data.servers.iter_mut().filter(|s| s.folder_id.as_deref() == Some(id)) {
        s.folder_id = None;
    }
    for p in data.probes.iter_mut().filter(|p| p.folder_id.as_deref() == Some(id)) {
        p.folder_id = None;
    }
    Ok(())
}

// ── Favoris ───────────────────────────────────────────────────────────────

/// Bascule le favori d'un serveur ou d'un service ; renvoie le nouvel état
pub fn toggle_favorite(data: &mut AppData, kind: ItemKind, id: &str) -> Result<bool, String> {
    let favorite = match kind {
        ItemKind::Server => &mut data.servers.iter_mut().find(|s| s.id == id).ok_or("Serveur introuvable")?.favorite,
        ItemKind::Probe => &mut data.probes.iter_mut().find(|p| p.id == id).ok_or("Service introuvable")?.favorite,
    };
    *favorite = !*favorite;
    Ok(*favorite)
}

// ── Serveurs et services ──────────────────────────────────────────────────

/// Champs d'organisation d'un formulaire serveur, validés avant toute modification.
/// `None` = inchangé : un formulaire qui ignore ces champs ne les efface pas.
#[derive(Debug, Default)]
pub struct ServerOrganisation {
    tag_ids: Option<Vec<String>>,
    folder_id: Option<Option<String>>,
    favorite: Option<bool>,
    custom_fields: Option<Vec<CustomField>>,
}

impl ServerOrganisation {
    pub fn from_payload(data: &AppData, p: &ServerPayload) -> Result<Self, String> {
        Ok(Self {
            tag_ids: p.tag_ids.clone().map(|ids| clean_tag_ids(&data.tags, ids)),
            // Some("") (ou un dossier inconnu) = sans dossier
            folder_id: p.folder_id.clone().map(|f| clean_folder_id(&data.folders, Some(f))),
            favorite: p.favorite,
            custom_fields: p.custom_fields.clone().map(validate_custom_fields).transpose()?,
        })
    }

    pub fn apply(self, s: &mut Server) {
        if let Some(t) = self.tag_ids {
            s.tag_ids = t;
        }
        if let Some(f) = self.folder_id {
            s.folder_id = f;
        }
        if let Some(f) = self.favorite {
            s.favorite = f;
        }
        if let Some(c) = self.custom_fields {
            s.custom_fields = c;
        }
    }
}

/// Assainit les tags et le dossier d'une sonde reçue du frontend
pub fn clean_probe(data: &AppData, probe: &mut crate::probes::Probe) {
    probe.tag_ids = clean_tag_ids(&data.tags, std::mem::take(&mut probe.tag_ids));
    probe.folder_id = clean_folder_id(&data.folders, probe.folder_id.take());
}

/// Remet l'organisation dans un état cohérent (après un import) : références orphelines
/// retirées, champs personnalisés invalides écartés
pub fn normalize(data: &mut AppData) {
    for s in data.servers.iter_mut() {
        s.tag_ids = clean_tag_ids(&data.tags, std::mem::take(&mut s.tag_ids));
        s.folder_id = clean_folder_id(&data.folders, s.folder_id.take());
        s.custom_fields = sanitize_custom_fields(std::mem::take(&mut s.custom_fields));
    }
    for p in data.probes.iter_mut() {
        p.tag_ids = clean_tag_ids(&data.tags, std::mem::take(&mut p.tag_ids));
        p.folder_id = clean_folder_id(&data.folders, p.folder_id.take());
    }
}

// ── Import ────────────────────────────────────────────────────────────────

/// Correspondance identifiant importé → identifiant local
#[derive(Debug, Default)]
pub struct Remap {
    tags: HashMap<String, String>,
    folders: HashMap<String, String>,
}

impl Remap {
    /// Réécrit les références d'un serveur importé ; ce qui n'a pas d'équivalent local disparaît
    pub fn apply_to_server(&self, s: &mut Server) {
        s.tag_ids = s.tag_ids.iter().filter_map(|t| self.tags.get(t).cloned()).collect();
        s.folder_id = s.folder_id.as_ref().and_then(|f| self.folders.get(f).cloned());
    }
}

/// Identifiant importé réutilisable tel quel, sinon un nouveau
fn import_id(id: &str, taken: impl Fn(&str) -> bool) -> String {
    let id = id.trim();
    if id.is_empty() || id.len() > ID_MAX || id.chars().any(char::is_control) || taken(id) {
        Uuid::new_v4().to_string()
    } else {
        id.to_string()
    }
}

/// Fusionne des tags et dossiers importés (données non fiables) dans `data`.
/// Un nom déjà présent (sans tenir compte de la casse) est rattaché à l'existant ;
/// les définitions invalides ou au-delà des plafonds sont écartées.
pub fn merge_definitions(data: &mut AppData, tags: Vec<Tag>, folders: Vec<Folder>) -> Remap {
    let mut remap = Remap::default();
    for t in tags {
        let (Ok(name), Ok(color)) = (clean_name(&t.name, TAG_NAME_MAX, "tag"), validate_color(&t.color)) else {
            continue;
        };
        if let Some(existing) = data.tags.iter().find(|x| same_name(&x.name, &name)) {
            remap.tags.insert(t.id, existing.id.clone());
            continue;
        }
        if data.tags.len() >= MAX_TAGS {
            continue;
        }
        let id = import_id(&t.id, |id| data.tags.iter().any(|x| x.id == id));
        remap.tags.insert(t.id, id.clone());
        data.tags.push(Tag { id, name, color });
    }
    for f in folders {
        let Ok(name) = clean_name(&f.name, FOLDER_NAME_MAX, "dossier") else {
            continue;
        };
        if let Some(existing) = data.folders.iter().find(|x| same_name(&x.name, &name)) {
            remap.folders.insert(f.id, existing.id.clone());
            continue;
        }
        if data.folders.len() >= MAX_FOLDERS {
            continue;
        }
        let id = import_id(&f.id, |id| data.folders.iter().any(|x| x.id == id));
        remap.folders.insert(f.id, id.clone());
        data.folders.push(Folder { id, name });
    }
    remap
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::OsType;
    use crate::probes::{Probe, ProbeAuth, ProbeKind};

    fn server(name: &str, ip: &str) -> Server {
        Server::new(name.into(), ip.into(), "02:00:00:00:00:01".into(), "root".into(), String::new(), 22, OsType::Linux, None, None)
    }

    fn probe(id: &str) -> Probe {
        Probe {
            id: id.into(),
            name: "Jellyfin".into(),
            enabled: true,
            kind: ProbeKind::Tcp { host: "192.168.1.20".into(), port: 8096 },
            server_id: None,
            interval_secs: 60,
            verify_tls: false,
            auth: ProbeAuth::None,
            secret: String::new(),
            tag_ids: Vec::new(),
            folder_id: None,
            favorite: false,
        }
    }

    fn tag(name: &str, color: &str) -> Tag {
        Tag { id: String::new(), name: name.into(), color: color.into() }
    }

    fn field(key: &str, value: &str) -> CustomField {
        CustomField { key: key.into(), value: value.into() }
    }

    fn payload() -> ServerPayload {
        serde_json::from_value(serde_json::json!({
            "name": "minipc", "ip": "192.168.1.10", "mac_address": "", "ssh_user": "root",
            "ssh_password": "", "ssh_port": 22, "os_type": "Linux"
        }))
        .unwrap()
    }

    #[test]
    fn colors_are_validated_and_normalized() {
        assert_eq!(validate_color("#3B82F6").unwrap(), "#3b82f6");
        assert_eq!(validate_color(" #00ff00 ").unwrap(), "#00ff00");
        for bad in ["", "#3b82f", "3b82f6", "#gggggg", "#3b82f6ff", "red", "#é3b82f"] {
            assert!(validate_color(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn tag_names_are_validated() {
        let mut data = AppData::default();
        assert!(save_tag(&mut data, tag("", "#ff0000")).is_err());
        assert!(save_tag(&mut data, tag("   ", "#ff0000")).is_err());
        assert!(save_tag(&mut data, tag(&"a".repeat(33), "#ff0000")).is_err());
        assert!(save_tag(&mut data, tag("a\u{7}b", "#ff0000")).is_err());
        assert!(save_tag(&mut data, tag("prod", "rouge")).is_err());
        // 32 caractères (et non 32 octets) : les accents comptent pour un
        let t = save_tag(&mut data, tag(&format!("  {}  ", "é".repeat(32)), "#FF0000")).unwrap();
        assert_eq!(t.name, "é".repeat(32));
        assert_eq!(t.color, "#ff0000");
        assert!(!t.id.is_empty());
    }

    #[test]
    fn tag_names_are_unique_case_insensitively() {
        let mut data = AppData::default();
        let prod = save_tag(&mut data, tag("Prod", "#ff0000")).unwrap();
        let err = save_tag(&mut data, tag("pROD", "#00ff00")).unwrap_err();
        assert!(err.contains("existe déjà"), "{err}");
        let media = save_tag(&mut data, tag("Média", "#0000ff")).unwrap();
        assert!(save_tag(&mut data, tag("MÉDIA", "#0000ff")).is_err());
        // Renommer un tag en changeant seulement la casse : autorisé
        let renamed = save_tag(&mut data, Tag { id: prod.id.clone(), name: "PROD".into(), color: "#123456".into() }).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.color.as_str()), ("PROD", "#123456"));
        // …mais pas prendre le nom d'un autre tag
        assert!(save_tag(&mut data, Tag { id: media.id, name: "prod".into(), color: "#123456".into() }).is_err());
        assert!(save_tag(&mut data, Tag { id: "inconnu".into(), name: "Lab".into(), color: "#123456".into() }).is_err());
        assert_eq!(data.tags.len(), 2);
    }

    #[test]
    fn tag_and_folder_counts_are_capped() {
        let mut data = AppData::default();
        for i in 0..MAX_TAGS {
            save_tag(&mut data, tag(&format!("t{i}"), "#abcdef")).unwrap();
        }
        assert!(save_tag(&mut data, tag("un de trop", "#abcdef")).is_err());
        for i in 0..MAX_FOLDERS {
            save_folder(&mut data, Folder { id: String::new(), name: format!("d{i}") }).unwrap();
        }
        assert!(save_folder(&mut data, Folder { id: String::new(), name: "un de trop".into() }).is_err());
    }

    #[test]
    fn folders_are_validated_renamed_and_unique() {
        let mut data = AppData::default();
        assert!(save_folder(&mut data, Folder { id: String::new(), name: " ".into() }).is_err());
        assert!(save_folder(&mut data, Folder { id: String::new(), name: "x".repeat(41) }).is_err());
        let lab = save_folder(&mut data, Folder { id: String::new(), name: "x".repeat(40) }).unwrap();
        let home = save_folder(&mut data, Folder { id: String::new(), name: "Maison".into() }).unwrap();
        assert!(save_folder(&mut data, Folder { id: String::new(), name: "maison".into() }).is_err());
        let renamed = save_folder(&mut data, Folder { id: lab.id.clone(), name: "Lab".into() }).unwrap();
        assert_eq!(renamed.id, lab.id);
        assert!(save_folder(&mut data, Folder { id: home.id, name: "LAB".into() }).is_err());
    }

    #[test]
    fn custom_fields_are_validated() {
        let ok = validate_custom_fields(vec![field("  Emplacement ", " Baie 2 "), field(&"k".repeat(40), &"v".repeat(500))]).unwrap();
        assert_eq!(ok[0], field("Emplacement", "Baie 2"));
        assert!(validate_custom_fields(vec![field("", "x")]).is_err());
        assert!(validate_custom_fields(vec![field(&"k".repeat(41), "x")]).is_err());
        assert!(validate_custom_fields(vec![field("k", &"v".repeat(501))]).is_err());
        assert!(validate_custom_fields(vec![field("k", "ligne\nsuivante")]).is_err());
        assert!(validate_custom_fields(vec![field("Série", "1"), field("SÉRIE", "2")]).unwrap_err().contains("double"));
        let twenty: Vec<_> = (0..MAX_CUSTOM_FIELDS).map(|i| field(&format!("k{i}"), "v")).collect();
        assert_eq!(validate_custom_fields(twenty.clone()).unwrap().len(), MAX_CUSTOM_FIELDS);
        let mut too_many = twenty;
        too_many.push(field("k20", "v"));
        assert!(validate_custom_fields(too_many).is_err());
        // Une valeur vide est permise (clé seule)
        assert!(validate_custom_fields(vec![field("À vérifier", "")]).is_ok());
    }

    #[test]
    fn deleting_a_tag_removes_it_from_servers_and_services() {
        let mut data = AppData::default();
        let prod = save_tag(&mut data, tag("Prod", "#ff0000")).unwrap();
        let media = save_tag(&mut data, tag("Media", "#00ff00")).unwrap();
        let mut s = server("minipc", "192.168.1.10");
        s.tag_ids = vec![prod.id.clone(), media.id.clone()];
        data.servers.push(s);
        let mut p = probe("p1");
        p.tag_ids = vec![prod.id.clone()];
        data.probes.push(p);

        delete_tag(&mut data, &prod.id).unwrap();
        assert_eq!(data.tags, vec![media.clone()]);
        assert_eq!(data.servers[0].tag_ids, vec![media.id]);
        assert!(data.probes[0].tag_ids.is_empty());
        assert!(delete_tag(&mut data, &prod.id).is_err());
    }

    #[test]
    fn deleting_a_folder_moves_items_to_no_folder() {
        let mut data = AppData::default();
        let lab = save_folder(&mut data, Folder { id: String::new(), name: "Lab".into() }).unwrap();
        let home = save_folder(&mut data, Folder { id: String::new(), name: "Maison".into() }).unwrap();
        for (i, f) in [&lab, &home].iter().enumerate() {
            let mut s = server(&format!("s{i}"), &format!("192.168.1.{}", 10 + i));
            s.folder_id = Some(f.id.clone());
            data.servers.push(s);
        }
        let mut p = probe("p1");
        p.folder_id = Some(lab.id.clone());
        data.probes.push(p);

        delete_folder(&mut data, &lab.id).unwrap();
        // Les éléments restent, seulement sortis du dossier supprimé
        assert_eq!(data.servers.len(), 2);
        assert_eq!(data.servers[0].folder_id, None);
        assert_eq!(data.servers[1].folder_id, Some(home.id));
        assert_eq!(data.probes.len(), 1);
        assert_eq!(data.probes[0].folder_id, None);
        assert!(delete_folder(&mut data, &lab.id).is_err());
    }

    #[test]
    fn favorites_toggle_for_servers_and_services() {
        let mut data = AppData::default();
        let s = server("minipc", "192.168.1.10");
        let id = s.id.clone();
        data.servers.push(s);
        data.probes.push(probe("p1"));
        assert!(toggle_favorite(&mut data, ItemKind::Server, &id).unwrap());
        assert!(data.servers[0].favorite);
        assert!(!toggle_favorite(&mut data, ItemKind::Server, &id).unwrap());
        assert!(toggle_favorite(&mut data, ItemKind::Probe, "p1").unwrap());
        assert!(data.probes[0].favorite);
        assert!(toggle_favorite(&mut data, ItemKind::Server, "inconnu").is_err());
        assert!(toggle_favorite(&mut data, ItemKind::Probe, "inconnu").is_err());
        let kind: ItemKind = serde_json::from_str("\"probe\"").unwrap();
        assert_eq!(kind, ItemKind::Probe);
    }

    #[test]
    fn server_payload_organisation_is_cleaned_and_optional() {
        let mut data = AppData::default();
        let prod = save_tag(&mut data, tag("Prod", "#ff0000")).unwrap();
        let lab = save_folder(&mut data, Folder { id: String::new(), name: "Lab".into() }).unwrap();
        let mut s = server("minipc", "192.168.1.10");
        s.tag_ids = vec![prod.id.clone()];
        s.folder_id = Some(lab.id.clone());
        s.favorite = true;
        s.custom_fields = vec![field("Baie", "2")];
        let before = s.clone();

        // Formulaire qui ignore ces champs : rien ne change
        ServerOrganisation::from_payload(&data, &payload()).unwrap().apply(&mut s);
        assert_eq!((&s.tag_ids, &s.folder_id, s.favorite, &s.custom_fields), (&before.tag_ids, &before.folder_id, before.favorite, &before.custom_fields));

        // Tags inconnus et doublons ignorés, dossier vide = sans dossier
        let mut p = payload();
        p.tag_ids = Some(vec![prod.id.clone(), "inconnu".into(), prod.id.clone()]);
        p.folder_id = Some(String::new());
        p.favorite = Some(false);
        p.custom_fields = Some(vec![field(" Série ", " SN-01 ")]);
        ServerOrganisation::from_payload(&data, &p).unwrap().apply(&mut s);
        assert_eq!(s.tag_ids, vec![prod.id.clone()]);
        assert_eq!(s.folder_id, None);
        assert!(!s.favorite);
        assert_eq!(s.custom_fields, vec![field("Série", "SN-01")]);

        // Dossier inconnu = sans dossier ; dossier connu conservé
        p.folder_id = Some("inconnu".into());
        ServerOrganisation::from_payload(&data, &p).unwrap().apply(&mut s);
        assert_eq!(s.folder_id, None);
        p.folder_id = Some(lab.id.clone());
        ServerOrganisation::from_payload(&data, &p).unwrap().apply(&mut s);
        assert_eq!(s.folder_id, Some(lab.id));

        // Champs invalides : refus avant toute modification
        p.custom_fields = Some(vec![field("", "x")]);
        assert!(ServerOrganisation::from_payload(&data, &p).is_err());
    }

    #[test]
    fn probe_organisation_is_cleaned() {
        let mut data = AppData::default();
        let prod = save_tag(&mut data, tag("Prod", "#ff0000")).unwrap();
        let mut p = probe("p1");
        p.tag_ids = vec!["inconnu".into(), prod.id.clone(), prod.id.clone()];
        p.folder_id = Some("inconnu".into());
        clean_probe(&data, &mut p);
        assert_eq!(p.tag_ids, vec![prod.id]);
        assert_eq!(p.folder_id, None);
    }

    #[test]
    fn old_data_json_without_organisation_fields_loads() {
        // data.json écrit avant la fonctionnalité : ni tags, ni dossiers, ni champs dans les éléments
        let json = r#"{
            "servers": [{"id":"s1","name":"minipc","ip":"192.168.1.10","mac_address":"02:00:00:00:00:01",
                         "ssh_user":"root","ssh_password":"","ssh_port":22,"shutdown_command":"poweroff",
                         "reboot_command":"reboot","os_type":"Linux","icon":null,"notes":null}],
            "groups": [],
            "settings": {
                "general": {"start_minimized": false, "auto_start": false, "notifications": true},
                "appearance": {"brightness": 1.0, "font_size": 14, "density": "Normal", "active_theme": "one-half-dark", "custom_themes": []},
                "network": {"ping_interval_secs": 30, "ping_timeout_ms": 2000, "ssh_timeout_secs": 30}
            },
            "encryption_salt": "abc123",
            "probes": [{"id":"p1","name":"Jellyfin","enabled":true,"kind":{"type":"Tcp","host":"192.168.1.20","port":8096},"interval_secs":60}]
        }"#;
        let data: AppData = serde_json::from_str(json).expect("ancien data.json lisible");
        assert!(data.tags.is_empty() && data.folders.is_empty());
        let s = &data.servers[0];
        assert!(s.tag_ids.is_empty() && s.folder_id.is_none() && !s.favorite && s.custom_fields.is_empty());
        let p = &data.probes[0];
        assert!(p.tag_ids.is_empty() && p.folder_id.is_none() && !p.favorite);
    }

    #[test]
    fn merge_reuses_existing_names_and_remaps_imported_servers() {
        let mut data = AppData::default();
        let prod = save_tag(&mut data, tag("Prod", "#ff0000")).unwrap();
        let home = save_folder(&mut data, Folder { id: String::new(), name: "Maison".into() }).unwrap();
        let imported_tags = vec![
            Tag { id: "x".into(), name: "prod".into(), color: "#00ff00".into() },
            Tag { id: "y".into(), name: "Media".into(), color: "#0000FF".into() },
            Tag { id: "z".into(), name: "Invalide".into(), color: "rouge".into() },
            // Même identifiant qu'un tag local mais autre nom : nouvel identifiant
            Tag { id: prod.id.clone(), name: "Lab".into(), color: "#111111".into() },
        ];
        let imported_folders = vec![
            Folder { id: "f1".into(), name: "MAISON".into() },
            Folder { id: "f2".into(), name: "Bureau".into() },
            Folder { id: "f3".into(), name: "".into() },
        ];
        let remap = merge_definitions(&mut data, imported_tags, imported_folders);
        assert_eq!(data.tags.len(), 3);
        assert_eq!(data.tags[1], Tag { id: "y".into(), name: "Media".into(), color: "#0000ff".into() });
        assert_ne!(data.tags[2].id, prod.id);
        assert_eq!(data.folders.len(), 2);

        let mut s = server("Workstation", "192.168.1.11");
        s.tag_ids = vec!["x".into(), "y".into(), "z".into()];
        s.folder_id = Some("f1".into());
        remap.apply_to_server(&mut s);
        assert_eq!(s.tag_ids, vec![prod.id.clone(), "y".to_string()]);
        assert_eq!(s.folder_id, Some(home.id));
        s.folder_id = Some("f3".into());
        remap.apply_to_server(&mut s);
        assert_eq!(s.folder_id, None);
    }

    #[test]
    fn normalize_removes_orphans_and_invalid_custom_fields() {
        let mut data = AppData::default();
        let prod = save_tag(&mut data, tag("Prod", "#ff0000")).unwrap();
        let mut s = server("minipc", "192.168.1.10");
        s.tag_ids = vec![prod.id.clone(), "orphelin".into()];
        s.folder_id = Some("orphelin".into());
        s.custom_fields = (0..25).map(|i| field(&format!("k{i}"), "v")).collect();
        s.custom_fields.insert(0, field("", "sans clé"));
        s.custom_fields.insert(1, field("K1", "doublon"));
        data.servers.push(s);
        let mut p = probe("p1");
        p.tag_ids = vec!["orphelin".into()];
        p.folder_id = Some("orphelin".into());
        data.probes.push(p);

        normalize(&mut data);
        let s = &data.servers[0];
        assert_eq!(s.tag_ids, vec![prod.id]);
        assert_eq!(s.folder_id, None);
        assert_eq!(s.custom_fields.len(), MAX_CUSTOM_FIELDS);
        assert_eq!(s.custom_fields[0], field("K1", "doublon"));
        assert!(!s.custom_fields.iter().any(|f| f.key == "k1"));
        assert!(data.probes[0].tag_ids.is_empty() && data.probes[0].folder_id.is_none());
    }
}
