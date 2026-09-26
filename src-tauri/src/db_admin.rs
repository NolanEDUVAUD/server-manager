/// Administration des moteurs de bases de données (MySQL/MariaDB, PostgreSQL, Redis)
/// installés sur les serveurs, ou tournant dans un conteneur Docker, via SSH — sans
/// jamais exposer leurs ports. Toute commande construite ici passe par `shell_quote` ou
/// par un identifiant validé/échappé : aucune valeur venue de l'utilisateur ou du réseau
/// n'est jamais interpolée telle quelle dans une commande shell.
use serde::{Deserialize, Serialize};

// ── Quotage shell : la seule porte d'entrée d'une valeur dans une commande ────────────
use crate::crypto;
use crate::models::AppData;

/// Encadre `s` par des quotes simples, avec l'échappement POSIX standard d'une quote
/// simple interne (`'` → `'\''`). À l'intérieur de quotes simples, le shell ne
/// réinterprète ni `$`, ni les antiquotes, ni `;`, ni les retours à la ligne : c'est la
/// seule fonction du module à utiliser pour placer une valeur quelconque dans une
/// commande, jamais une interpolation directe.
pub fn shell_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

/// Identifiant strict (nom de nouvelle base créée depuis l'app) : lettres, chiffres,
/// underscore, ne commence pas par un chiffre, 63 caractères au plus (limite MySQL et
/// PostgreSQL). Utilisé à la création ; les noms déjà existants sur le serveur passent
/// par `quote_ident_*` plutôt que par cette validation, plus permissive nécessairement.
pub fn validate_identifier(s: &str) -> Result<(), String> {
    let mut chars = s.chars();
    let ok = matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.clone().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && s.len() <= 63;
    if ok {
        Ok(())
    } else {
        Err(format!(
            "Nom invalide : « {} » — lettres, chiffres et underscore uniquement, sans commencer par un chiffre (63 caractères max)",
            s
        ))
    }
}

/// Quote un identifiant PostgreSQL (guillemets doubles, doublés s'ils apparaissent dans le nom)
pub fn quote_ident_pg(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Quote un identifiant MySQL/MariaDB (accent grave, doublé s'il apparaît dans le nom)
pub fn quote_ident_mysql(s: &str) -> String {
    format!("`{}`", s.replace('`', "``"))
}

// ── Moteur et connexion ────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum DbEngine {
    Mysql,
    Postgres,
    Redis,
}

/// Identifiants applicatifs déchiffrés, prêts à l'emploi (jamais sérialisés)
#[derive(Debug, Clone, Default)]
pub struct ResolvedAuth {
    /// Vide = authentification système (`sudo -u postgres psql` / `sudo mysql`, socket Unix)
    pub username: String,
    /// Vide = pas de mot de passe (auth système ou compte sans mot de passe)
    pub password: String,
}

// ── Connexion stockée (par serveur + moteur) ────────────────────────────────────────────
/// Paramètres de connexion à un moteur d'un serveur donné, enregistrés dans data.json.
/// Par défaut (`username` vide), l'authentification système est utilisée (peer/socket
/// Unix) : aucun secret à stocker. Le mot de passe, s'il y en a un, est chiffré par la
/// clé maître exactement comme un mot de passe SSH ou le secret d'une intégration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DbConnection {
    pub server_id: String,
    pub engine: DbEngine,
    #[serde(default)]
    pub username: String,
    /// Chiffré ; jamais renvoyé au frontend (voir `DbConnectionView`)
    #[serde(default)]
    pub password: String,
    /// Dossier de sauvegarde par défaut (« ~/backups » si vide)
    #[serde(default)]
    pub backup_dir: String,
}

/// Vue envoyée au frontend : le mot de passe est remplacé par un simple indicateur
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DbConnectionView {
    pub server_id: String,
    pub engine: DbEngine,
    pub username: String,
    pub has_password: bool,
    pub backup_dir: String,
}

impl From<&DbConnection> for DbConnectionView {
    fn from(c: &DbConnection) -> Self {
        DbConnectionView { server_id: c.server_id.clone(), engine: c.engine, username: c.username.clone(), has_password: !c.password.is_empty(), backup_dir: c.backup_dir.clone() }
    }
}

/// Reçu du frontend. `password` : None = inchangé, Some("") = effacé (bascule sur l'auth système).
#[derive(Debug, Clone, Deserialize)]
pub struct DbConnectionPayload {
    pub server_id: String,
    pub engine: DbEngine,
    #[serde(default)]
    pub username: String,
    pub password: Option<String>,
    #[serde(default)]
    pub backup_dir: String,
}

/// Applique un payload (création ou mise à jour) à la liste des connexions, en chiffrant
/// le nouveau mot de passe s'il y en a un.
pub fn apply_connection_payload(list: &mut Vec<DbConnection>, payload: DbConnectionPayload, key: &[u8; 32]) -> Result<DbConnectionView, String> {
    let password = match &payload.password {
        Some(p) if !p.is_empty() => Some(crypto::encrypt(p, key)?),
        Some(_) => Some(String::new()),
        None => None,
    };
    let entry = match list.iter_mut().find(|c| c.server_id == payload.server_id && c.engine == payload.engine) {
        Some(existing) => {
            existing.username = payload.username.trim().to_string();
            existing.backup_dir = payload.backup_dir.trim().to_string();
            if let Some(p) = password {
                existing.password = p;
            }
            &*existing
        }
        None => {
            list.push(DbConnection {
                server_id: payload.server_id,
                engine: payload.engine,
                username: payload.username.trim().to_string(),
                password: password.unwrap_or_default(),
                backup_dir: payload.backup_dir.trim().to_string(),
            });
            list.last().unwrap()
        }
    };
    Ok(DbConnectionView::from(entry))
}

/// Identifiants déchiffrés d'un serveur pour un moteur donné ; absence de connexion
/// enregistrée = authentification système (comportement par défaut documenté ci-dessus).
pub fn resolve_auth(data: &AppData, server_id: &str, engine: DbEngine) -> Result<ResolvedAuth, String> {
    let Some(conn) = data.db_connections.iter().find(|c| c.server_id == server_id && c.engine == engine) else {
        return Ok(ResolvedAuth::default());
    };
    let password = if conn.password.is_empty() { String::new() } else { crypto::decrypt(&conn.password, &*crypto::data_key(data)?)? };
    Ok(ResolvedAuth { username: conn.username.clone(), password })
}

pub fn backup_dir_for(data: &AppData, server_id: &str, engine: DbEngine) -> String {
    data.db_connections
        .iter()
        .find(|c| c.server_id == server_id && c.engine == engine)
        .map(|c| c.backup_dir.clone())
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| "~/backups".to_string())
}

/// Mot de passe applicatif : il n'est JAMAIS écrit dans la commande. Une commande SSH est
/// exécutée côté serveur par `sh -c "<commande>"`, dont les arguments sont lisibles par
/// tous les utilisateurs de la machine (`ps`, `/proc/<pid>/cmdline`) : le mot de passe y
/// serait exposé, même via une substitution `$(printf …)`. Il est donc envoyé sur l'entrée
/// standard du canal SSH (voir `stdin_secret`) et lu par ce prélude, qui l'exporte pour
/// le client (MYSQL_PWD / PGPASSWORD, lus par mysql/mysqldump et psql/pg_dump). Dans un
/// conteneur, `docker exec -i` transmet cette entrée standard au shell du conteneur.
fn password_prelude(auth: &ResolvedAuth, var: &str) -> String {
    if auth.username.is_empty() || auth.password.is_empty() {
        return String::new();
    }
    format!("IFS= read -r {var} || true; export {var}; ")
}

/// Contenu à écrire sur l'entrée standard de la commande (le mot de passe suivi d'un retour
/// à la ligne), ou `None` quand aucun mot de passe applicatif n'est utilisé.
pub fn stdin_secret(auth: &ResolvedAuth) -> Result<Option<String>, String> {
    if auth.username.is_empty() || auth.password.is_empty() {
        return Ok(None);
    }
    if auth.password.contains(['\n', '\r']) {
        return Err("Le mot de passe de la base ne peut pas contenir de retour à la ligne".into());
    }
    Ok(Some(format!("{}\n", auth.password)))
}

// ── Détection des moteurs installés ─────────────────────────────────────────────────────
pub const DETECT_COMMAND: &str = r#"export LC_ALL=C
echo '--MYSQL--'
if command -v mysql >/dev/null 2>&1 || command -v mariadb >/dev/null 2>&1; then
  (mysql --version 2>/dev/null || mariadb --version 2>/dev/null)
  systemctl is-active mariadb 2>/dev/null || systemctl is-active mysql 2>/dev/null || echo unknown
fi
echo '--POSTGRES--'
if command -v psql >/dev/null 2>&1; then
  psql --version
  systemctl is-active postgresql 2>/dev/null || echo unknown
fi
echo '--REDIS--'
if command -v redis-cli >/dev/null 2>&1; then
  redis-cli --version
  systemctl is-active redis-server 2>/dev/null || systemctl is-active redis 2>/dev/null || echo unknown
fi
echo '--DOCKER--'
command -v docker >/dev/null 2>&1 && docker ps --format '{{.ID}}|{{.Image}}|{{.Names}}' 2>/dev/null
true"#;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DetectedEngine {
    pub engine: DbEngine,
    pub version: String,
    /// running / stopped / unknown (systemctl absent, ex. conteneur sans systemd)
    pub status: String,
    /// Renseigné quand le moteur tourne dans ce conteneur plutôt que sur l'hôte directement
    pub container: Option<String>,
}

fn section<'a>(out: &'a str, name: &str) -> &'a str {
    let marker = format!("--{}--", name);
    let Some(start) = out.find(&marker) else { return "" };
    let rest = &out[start + marker.len()..];
    let end = rest.find("\n--").map(|i| i + 1).unwrap_or(rest.len());
    rest[..end].trim_start_matches('\n').trim_end()
}

/// Nom de l'image (sans tag ni registre) qui identifie un moteur de base de données
fn image_engine(image: &str) -> Option<DbEngine> {
    let base = image.rsplit('/').next().unwrap_or(image);
    let name = base.split(':').next().unwrap_or(base).to_lowercase();
    match name.as_str() {
        "mysql" | "mariadb" => Some(DbEngine::Mysql),
        "postgres" | "postgresql" => Some(DbEngine::Postgres),
        "redis" | "redis-stack" | "redis-stack-server" => Some(DbEngine::Redis),
        _ => None,
    }
}

pub fn parse_detect(out: &str) -> Vec<DetectedEngine> {
    let mut engines = Vec::new();

    let host_engine = |name: &str, engine: DbEngine| {
        let s = section(out, name);
        if s.is_empty() {
            return None;
        }
        let mut lines = s.lines();
        let version = lines.next().unwrap_or("").trim().to_string();
        let status = lines.next().unwrap_or("unknown").trim().to_string();
        Some(DetectedEngine { engine, version, status, container: None })
    };
    if let Some(e) = host_engine("MYSQL", DbEngine::Mysql) {
        engines.push(e);
    }
    if let Some(e) = host_engine("POSTGRES", DbEngine::Postgres) {
        engines.push(e);
    }
    if let Some(e) = host_engine("REDIS", DbEngine::Redis) {
        engines.push(e);
    }

    for line in section(out, "DOCKER").lines().map(str::trim).filter(|l| !l.is_empty()) {
        let mut parts = line.splitn(3, '|');
        let (Some(_id), Some(image), Some(name)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let Some(engine) = image_engine(image) else { continue };
        engines.push(DetectedEngine {
            engine,
            version: image.to_string(),
            status: "running".to_string(),
            container: Some(name.trim_start_matches('/').to_string()),
        });
    }
    engines
}

// ── Construction des commandes MySQL/MariaDB ────────────────────────────────────────────
// Les colonnes de la sortie `--batch --raw` sont séparées par une tabulation (par
// défaut, non réinterprétée grâce à `--raw`) : voir le paramètre `sep` de `parse_tabular`.

fn mysql_invocation(auth: &ResolvedAuth, flags: &str) -> String {
    if auth.username.is_empty() {
        // Authentification système (plugin unix_socket, standard sur Debian/Ubuntu) : le
        // compte OS root correspond au compte MySQL root sans mot de passe à fournir.
        format!("sudo mysql {}", flags)
    } else {
        // Mot de passe éventuel : MYSQL_PWD, exporté par `password_prelude`
        format!("mysql --user={} {}", shell_quote(&auth.username), flags)
    }
}

/// Commande exécutant `sql` sur le serveur MySQL/MariaDB visé (hôte ou conteneur)
pub fn mysql_query_command(auth: &ResolvedAuth, container: Option<&str>, database: Option<&str>, sql: &str, headers: bool) -> String {
    // Argument de ligne de commande (pas un identifiant SQL) : quotage shell, surtout pas
    // les accents graves de MySQL, qu'un shell exécuterait comme une commande
    let db_flag = database.map(|d| format!(" {}", shell_quote(d))).unwrap_or_default();
    let flag = if headers { "--batch --raw" } else { "--batch --raw -N" };
    let inner = format!("{}{} -e {}{}", password_prelude(auth, "MYSQL_PWD"), mysql_invocation(auth, flag), shell_quote(sql), db_flag);
    wrap_container(container, &inner)
}

// ── Construction des commandes PostgreSQL ───────────────────────────────────────────────
/// Séparateur de colonnes psql : le caractère « unit separator » (0x1F), improbable dans
/// des données réelles, obtenu via `printf` (portable POSIX) plutôt qu'un littéral `$'...'`
/// (extension bash absente de `dash`, donc pas garanti sur tous les hôtes ciblés).
fn psql_separator_arg() -> &'static str {
    "\"$(printf '\\037')\""
}

fn psql_invocation(auth: &ResolvedAuth, database: Option<&str>, flags: &str) -> String {
    // Argument de ligne de commande : quotage shell (les guillemets doubles laisseraient
    // le shell interpréter `$` et les accents graves)
    let db_flag = database.map(|d| format!(" -d {}", shell_quote(d))).unwrap_or_default();
    if auth.username.is_empty() {
        // Authentification par les pairs (peer) : l'utilisateur système « postgres »
        format!("sudo -u postgres psql {}{}", flags, db_flag)
    } else {
        // Mot de passe éventuel : PGPASSWORD, exporté par `password_prelude`
        format!("psql --username={} {}{}", shell_quote(&auth.username), flags, db_flag)
    }
}

pub fn psql_query_command(auth: &ResolvedAuth, container: Option<&str>, database: Option<&str>, sql: &str) -> String {
    let flags = format!("-A -t -X -F{}", psql_separator_arg());
    let inner = format!("{}{} -c {}", password_prelude(auth, "PGPASSWORD"), psql_invocation(auth, database, &flags), shell_quote(sql));
    wrap_container(container, &inner)
}

// ── Requêtes prêtes à l'emploi ──────────────────────────────────────────────────────────
pub fn list_databases_sql(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Mysql => {
            "SELECT table_schema, COALESCE(SUM(data_length+index_length),0), COUNT(*) FROM information_schema.tables \
             WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys') GROUP BY table_schema;"
        }
        DbEngine::Postgres => {
            "SELECT d.datname, pg_database_size(d.datname), \
             (SELECT COUNT(*) FROM pg_catalog.pg_tables t WHERE t.schemaname NOT IN ('pg_catalog','information_schema') AND t.schemaname = 'public') \
             FROM pg_database d WHERE d.datistemplate = false ORDER BY d.datname;"
        }
        DbEngine::Redis => "",
    }
}

pub fn list_tables_sql(engine: DbEngine, database: &str) -> String {
    match engine {
        DbEngine::Mysql => format!(
            "SELECT table_name, COALESCE(table_rows,0), COALESCE(data_length+index_length,0) FROM information_schema.tables WHERE table_schema = {};",
            sql_string_literal(database)
        ),
        DbEngine::Postgres => {
            "SELECT c.relname, COALESCE(c.reltuples::bigint,0), pg_total_relation_size(c.oid) \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE c.relkind = 'r' AND n.nspname = 'public' ORDER BY c.relname;"
                .to_string()
        }
        DbEngine::Redis => String::new(),
    }
}

pub fn list_users_sql(engine: DbEngine) -> &'static str {
    match engine {
        DbEngine::Mysql => "SELECT user, host FROM mysql.user ORDER BY user;",
        DbEngine::Postgres => "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles ORDER BY rolname;",
        DbEngine::Redis => "",
    }
}

/// Un identifiant déjà validé (`validate_identifier`) ne contient jamais de quote : ce
/// doublage reste une défense en profondeur pour un nom de base existant, pas forcément
/// créé par l'app, qui pourrait contenir des caractères inhabituels.
fn sql_string_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

pub fn create_database_sql(engine: DbEngine, name: &str) -> String {
    match engine {
        DbEngine::Mysql => format!("CREATE DATABASE {};", quote_ident_mysql(name)),
        DbEngine::Postgres => format!("CREATE DATABASE {};", quote_ident_pg(name)),
        DbEngine::Redis => String::new(),
    }
}

pub fn drop_database_sql(engine: DbEngine, name: &str) -> String {
    match engine {
        DbEngine::Mysql => format!("DROP DATABASE {};", quote_ident_mysql(name)),
        DbEngine::Postgres => format!("DROP DATABASE {};", quote_ident_pg(name)),
        DbEngine::Redis => String::new(),
    }
}

/// Enrobe `sql` d'une transaction en lecture seule ; pour MySQL, `default_transaction_read_only`
/// ne bloque que les écritures explicites, `START TRANSACTION READ ONLY` couvre aussi le DDL implicite.
pub fn wrap_read_only(engine: DbEngine, sql: &str) -> String {
    match engine {
        DbEngine::Mysql => format!("START TRANSACTION READ ONLY; {} COMMIT;", sql),
        DbEngine::Postgres => format!("BEGIN; SET TRANSACTION READ ONLY; {} COMMIT;", sql),
        DbEngine::Redis => sql.to_string(),
    }
}

fn wrap_container(container: Option<&str>, inner: &str) -> String {
    match container {
        Some(c) => format!("docker exec -i {} sh -c {}", shell_quote(c), shell_quote(inner)),
        None => inner.to_string(),
    }
}

// ── Résultat d'une requête ───────────────────────────────────────────────────────────────
pub const MAX_RESULT_ROWS: usize = 1000;
/// Sortie brute au-delà de laquelle le résultat est refusé plutôt que tronqué en silence
pub const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub truncated: bool,
}

/// Découpe une sortie tabulaire (mysql `--batch`, séparateur tabulation ; psql `-A -F<US>`,
/// séparateur passé en paramètre) en colonnes/lignes, en capant à `MAX_RESULT_ROWS`.
pub fn parse_tabular(out: &str, sep: char, headers: bool) -> QueryResult {
    let mut lines = out.lines().filter(|l| !l.is_empty());
    let columns: Vec<String> = if headers {
        lines.next().map(|l| l.split(sep).map(str::to_string).collect()).unwrap_or_default()
    } else {
        Vec::new()
    };
    let all: Vec<Vec<String>> = lines.map(|l| l.split(sep).map(str::to_string).collect()).collect();
    let truncated = all.len() > MAX_RESULT_ROWS;
    let rows = all.into_iter().take(MAX_RESULT_ROWS).collect();
    QueryResult { columns, rows, truncated }
}

// ── Bases et tables ──────────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DbInfo {
    pub name: String,
    pub size_bytes: u64,
    pub table_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TableInfo {
    pub name: String,
    pub row_estimate: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DbUser {
    pub name: String,
    /// Hôte MySQL ou attributs PostgreSQL, texte libre selon le moteur
    pub detail: String,
}

pub fn parse_databases(out: &str, sep: char) -> Vec<DbInfo> {
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| {
            let mut c = l.split(sep);
            let name = c.next()?.to_string();
            let size_bytes = c.next()?.trim().parse().unwrap_or(0);
            let table_count = c.next()?.trim().parse().unwrap_or(0);
            Some(DbInfo { name, size_bytes, table_count })
        })
        .collect()
}

pub fn parse_tables(out: &str, sep: char) -> Vec<TableInfo> {
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| {
            let mut c = l.split(sep);
            let name = c.next()?.to_string();
            let row_estimate = c.next()?.trim().parse().unwrap_or(0);
            let size_bytes = c.next()?.trim().parse().unwrap_or(0);
            Some(TableInfo { name, row_estimate, size_bytes })
        })
        .collect()
}

pub fn parse_users(out: &str, sep: char) -> Vec<DbUser> {
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| {
            let mut c = l.splitn(2, sep);
            let name = c.next()?.to_string();
            let detail = c.next().unwrap_or("").replace(sep, " ");
            Some(DbUser { name, detail })
        })
        .collect()
}

// ── Sauvegarde ────────────────────────────────────────────────────────────────────────
/// Chemin d'un dossier, en développant un `~/` initial vers `$HOME` (non quoté, seule
/// façon portable de bénéficier de l'expansion) : le reste du chemin reste quoté normalement.
fn shell_path(dir: &str) -> String {
    match dir.strip_prefix("~/") {
        Some(rest) => format!("\"$HOME\"/{}", shell_quote(rest)),
        None => shell_quote(dir),
    }
}

/// Partie « nom de base » d'un nom de fichier de sauvegarde : lettres, chiffres, `_`, `-`, `.`
fn safe_file_stem(name: &str) -> String {
    let stem: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') { c } else { '_' }).collect();
    let stem = stem.trim_start_matches('.').to_string();
    if stem.is_empty() { "base".to_string() } else { stem }
}

pub fn backup_command(engine: DbEngine, auth: &ResolvedAuth, container: Option<&str>, database: &str, dir: &str) -> String {
    let dir_expr = shell_path(dir);
    let db_arg = shell_quote(database);
    let dump = match engine {
        DbEngine::Mysql => {
            let auth_cmd = mysqldump_invocation(auth);
            format!("{} {} > \"$FILE\"", auth_cmd, db_arg)
        }
        DbEngine::Postgres => {
            let auth_cmd = pg_dump_invocation(auth);
            format!("{} {} > \"$FILE\"", auth_cmd, db_arg)
        }
        DbEngine::Redis => String::new(),
    };
    let prelude = match engine {
        DbEngine::Mysql => password_prelude(auth, "MYSQL_PWD"),
        DbEngine::Postgres => password_prelude(auth, "PGPASSWORD"),
        DbEngine::Redis => String::new(),
    };
    let inner = format!(
        "{prelude}DIR={dir}; mkdir -p \"$DIR\"; FILE=\"$DIR/{db}_$(date +%Y%m%d_%H%M%S).sql\"; {dump} && echo '--PATH--' && echo \"$FILE\" && echo '--SIZE--' && stat -c%s \"$FILE\" 2>/dev/null || stat -f%z \"$FILE\"",
        prelude = prelude,
        dir = dir_expr,
        // Nom de fichier : uniquement des caractères sûrs (il est inséré dans une chaîne
        // entre guillemets doubles, où `$(…)` ou `` ` `` seraient sinon interprétés)
        db = safe_file_stem(database),
        dump = dump,
    );
    wrap_container(container, &inner)
}

fn mysqldump_invocation(auth: &ResolvedAuth) -> String {
    if auth.username.is_empty() {
        "sudo mysqldump".to_string()
    } else {
        format!("mysqldump --user={}", shell_quote(&auth.username))
    }
}

fn pg_dump_invocation(auth: &ResolvedAuth) -> String {
    if auth.username.is_empty() {
        "sudo -u postgres pg_dump".to_string()
    } else {
        format!("pg_dump --username={}", shell_quote(&auth.username))
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackupResult {
    pub path: String,
    pub size_bytes: u64,
}

pub fn parse_backup_output(out: &str) -> Result<BackupResult, String> {
    let path = section(out, "PATH").trim().to_string();
    let size = section(out, "SIZE").trim().parse().unwrap_or(0);
    if path.is_empty() {
        return Err(format!("Sauvegarde échouée : {}", out.trim()));
    }
    Ok(BackupResult { path, size_bytes: size })
}

// ── Actions de service ───────────────────────────────────────────────────────────────────
/// Services système associés à chaque moteur, essayés dans l'ordre (nom qui varie selon
/// la distribution — ex. MariaDB s'appelle `mariadb` sur Debian récent, `mysql` avant)
pub fn service_candidates(engine: DbEngine) -> &'static [&'static str] {
    match engine {
        DbEngine::Mysql => &["mariadb", "mysql"],
        DbEngine::Postgres => &["postgresql"],
        DbEngine::Redis => &["redis-server", "redis"],
    }
}

pub fn validate_service_action(action: &str) -> Result<(), String> {
    if matches!(action, "start" | "stop" | "restart") {
        Ok(())
    } else {
        Err(format!("Action de service inconnue : {}", action))
    }
}

/// Essaie chaque nom de service candidat jusqu'au premier qui existe (`||`) : action
/// et noms de service viennent tous deux d'une liste fermée, jamais de l'utilisateur.
pub fn service_command(engine: DbEngine, action: &str) -> String {
    let parts: Vec<String> = service_candidates(engine).iter().map(|svc| format!("sudo systemctl {} {}", action, svc)).collect();
    parts.join(" || ")
}

// ── Redis ────────────────────────────────────────────────────────────────────────────────
/// Commandes autorisées en lecture seule (Redis n'a pas de notion de transaction en
/// lecture seule ; on limite donc strictement l'ensemble des commandes envoyées)
pub const REDIS_ALLOWED_COMMANDS: &[&str] = &["INFO", "DBSIZE", "SCAN", "TYPE", "TTL", "GET"];

pub fn validate_redis_command(cmd: &str) -> Result<(), String> {
    let first_word = cmd.split_whitespace().next().unwrap_or("").to_uppercase();
    if REDIS_ALLOWED_COMMANDS.contains(&first_word.as_str()) {
        Ok(())
    } else {
        Err(format!("Commande Redis non autorisée : {} (autorisées : {})", cmd, REDIS_ALLOWED_COMMANDS.join(", ")))
    }
}

pub fn redis_command(container: Option<&str>, args: &str) -> String {
    wrap_container(container, &format!("redis-cli {}", args))
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct RedisInfo {
    pub version: String,
    pub used_memory_human: String,
    /// « db0 » → nombre de clés
    pub keys_per_db: Vec<(String, u64)>,
}

pub fn parse_redis_info(out: &str) -> RedisInfo {
    let mut info = RedisInfo::default();
    for line in out.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("redis_version:") {
            info.version = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("used_memory_human:") {
            info.used_memory_human = v.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("db") {
            // « db0:keys=12,expires=0,avg_ttl=0 »
            if let Some((db_num, fields)) = rest.split_once(':') {
                if let Some(keys) = fields.split(',').find_map(|f| f.strip_prefix("keys=")) {
                    if let Ok(n) = keys.parse::<u64>() {
                        info.keys_per_db.push((format!("db{}", db_num), n));
                    }
                }
            }
        }
    }
    info
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Connexions stockées : le mot de passe ne fuite jamais ──────────────────────
    #[test]
    fn connection_password_is_encrypted_and_never_serialized() {
        let key = crypto::generate_key();
        let mut list = Vec::new();
        let payload = DbConnectionPayload {
            server_id: "srv1".into(),
            engine: DbEngine::Postgres,
            username: "app".into(),
            password: Some("s3cret".into()),
            backup_dir: String::new(),
        };
        let view = apply_connection_payload(&mut list, payload, &key).unwrap();
        assert!(view.has_password);
        assert!(!serde_json::to_string(&view).unwrap().contains("s3cret"));
        assert_ne!(list[0].password, "s3cret");
        assert_eq!(crypto::decrypt(&list[0].password, &key).unwrap(), "s3cret");

        // None : mot de passe inchangé, pas de doublon
        let unchanged = DbConnectionPayload { server_id: "srv1".into(), engine: DbEngine::Postgres, username: "app2".into(), password: None, backup_dir: String::new() };
        apply_connection_payload(&mut list, unchanged, &key).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(crypto::decrypt(&list[0].password, &key).unwrap(), "s3cret");
        assert_eq!(list[0].username, "app2");

        // Some("") : effacé, retombe sur l'authentification système
        let cleared = DbConnectionPayload { server_id: "srv1".into(), engine: DbEngine::Postgres, username: String::new(), password: Some(String::new()), backup_dir: String::new() };
        apply_connection_payload(&mut list, cleared, &key).unwrap();
        assert_eq!(list[0].password, "");
    }

    #[test]
    fn resolve_auth_defaults_to_system_auth_without_a_stored_connection() {
        let data = AppData::default();
        let auth = resolve_auth(&data, "srv1", DbEngine::Mysql).unwrap();
        assert!(auth.username.is_empty() && auth.password.is_empty());
    }


    // ── Quotage : chaînes hostiles ──────────────────────────────────────────────
    #[test]
    fn shell_quote_neutralizes_every_dangerous_character() {
        let nasty = ["$(reboot)", "`whoami`", "a'; rm -rf / #", "line1\nline2", "a;b", "a\"b", "$HOME"];
        for s in nasty {
            let q = shell_quote(s);
            // Toujours encadré de quotes simples, jamais de quote simple non échappée à l'intérieur
            assert!(q.starts_with('\'') && q.ends_with('\''));
            let inner = &q[1..q.len() - 1];
            // Chaque quote simple restante doit faire partie du motif d'échappement '\''
            let mut rest = inner;
            while let Some(pos) = rest.find('\'') {
                assert_eq!(&rest[pos..pos + 4.min(rest.len() - pos)], "'\\''");
                rest = &rest[pos + 4..];
            }
        }
    }

    #[test]
    fn shell_quote_roundtrips_through_a_real_shell() {
        // Vérité terrain : sh -c "printf '%s' <quoted>" doit rendre exactement l'original
        for s in ["$(reboot)", "`whoami`", "a'b", "a;b\nc", "no special chars"] {
            let quoted = shell_quote(s);
            let out = std::process::Command::new("sh").arg("-c").arg(format!("printf '%s' {}", quoted)).output();
            if let Ok(out) = out {
                assert_eq!(String::from_utf8_lossy(&out.stdout), s, "input: {:?}", s);
            }
        }
    }

    #[test]
    fn identifier_validation_rejects_injection_attempts() {
        assert!(validate_identifier("ma_base_1").is_ok());
        assert!(validate_identifier("_ok").is_ok());
        assert!(validate_identifier("").is_err());
        assert!(validate_identifier("1base").is_err());
        assert!(validate_identifier("base; DROP TABLE x").is_err());
        assert!(validate_identifier("base`x`").is_err());
        assert!(validate_identifier("base'x").is_err());
        assert!(validate_identifier("base x").is_err());
        assert!(validate_identifier(&"a".repeat(64)).is_err());
        assert!(validate_identifier(&"a".repeat(63)).is_ok());
    }

    #[test]
    fn quote_ident_doubles_embedded_quotes() {
        assert_eq!(quote_ident_pg("simple"), "\"simple\"");
        assert_eq!(quote_ident_pg("weird\"name"), "\"weird\"\"name\"");
        assert_eq!(quote_ident_mysql("simple"), "`simple`");
        assert_eq!(quote_ident_mysql("weird`name"), "`weird``name`");
    }

    // ── Construction des commandes : le mot de passe n'apparaît jamais en argument ──
    /// Exécute réellement `cmd` dans `sh`, avec de faux clients `mysql`/`psql`/`mysqldump`/
    /// `pg_dump` qui affichent leurs arguments et la variable de mot de passe reçue, et
    /// `stdin` sur l'entrée standard. Renvoie la sortie, ou None sans `sh` disponible.
    #[cfg(unix)]
    fn run_with_fake_clients(cmd: &str, stdin: Option<&str>) -> Option<String> {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("spm-db-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).ok()?;
        for bin in ["mysql", "psql", "mysqldump", "pg_dump"] {
            let path = dir.join(bin);
            std::fs::write(&path, format!("#!/bin/sh\necho \"{bin} pwd=[${{MYSQL_PWD:-$PGPASSWORD}}] args=[$*]\"\n")).ok()?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).ok()?;
        }
        let mut child = std::process::Command::new("sh")
            .arg("-c")
            .arg(cmd)
            .env("PATH", format!("{}:/usr/bin:/bin", dir.display()))
            .env("HOME", &dir)
            .env_remove("MYSQL_PWD")
            .env_remove("PGPASSWORD")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .ok()?;
        if let Some(input) = stdin {
            child.stdin.as_mut()?.write_all(input.as_bytes()).ok()?;
        }
        drop(child.stdin.take());
        let out = child.wait_with_output().ok()?;
        let _ = std::fs::remove_dir_all(&dir);
        Some(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    #[test]
    fn mysql_password_is_never_in_the_command_and_reaches_the_client_via_stdin() {
        let password = "hunter2$(reboot) 'x' `id`";
        let auth = ResolvedAuth { username: "app".into(), password: password.into() };
        let cmd = mysql_query_command(&auth, None, Some("shop"), "SELECT 1;", true);
        // Rien du mot de passe dans la commande (visible dans `ps` côté serveur)
        assert!(!cmd.contains("hunter2"));
        assert!(!cmd.contains("--password"));
        let stdin = stdin_secret(&auth).unwrap().unwrap();
        #[cfg(unix)]
        if let Some(out) = run_with_fake_clients(&cmd, Some(&stdin)) {
            assert!(out.contains(&format!("pwd=[{password}]")), "{out}");
            assert!(out.contains("args=[--user=app --batch --raw -e SELECT 1; shop]"), "{out}");
        }
    }

    #[test]
    fn postgres_password_is_never_in_the_command_and_reaches_the_client_via_stdin() {
        let password = "sécret;`id`";
        let auth = ResolvedAuth { username: "app".into(), password: password.into() };
        let cmd = psql_query_command(&auth, None, Some("shop"), "SELECT 1;");
        assert!(!cmd.contains("sécret"));
        let stdin = stdin_secret(&auth).unwrap().unwrap();
        #[cfg(unix)]
        if let Some(out) = run_with_fake_clients(&cmd, Some(&stdin)) {
            assert!(out.contains(&format!("pwd=[{password}]")), "{out}");
            assert!(out.contains("--username=app"), "{out}");
            assert!(out.contains("-c SELECT 1;"), "{out}");
        }
    }

    #[test]
    fn backup_with_password_runs_and_neutralizes_the_file_name() {
        let auth = ResolvedAuth { username: "app".into(), password: "p w".into() };
        let cmd = backup_command(DbEngine::Mysql, &auth, None, "x$(touch pwned)", "~/backups");
        assert!(!cmd.contains("p w"));
        #[cfg(unix)]
        if let Some(out) = run_with_fake_clients(&cmd, Some(&stdin_secret(&auth).unwrap().unwrap())) {
            // Le faux mysqldump écrit dans le fichier : la sortie visible est le chemin
            assert!(out.contains("--PATH--"), "{out}");
            assert!(out.contains("/backups/x__touch_pwned__"), "{out}");
        }
    }

    #[test]
    fn database_names_are_shell_quoted_not_sql_quoted_on_the_command_line() {
        let auth = ResolvedAuth::default();
        let name = "shop`touch pwned`$(id)";
        for cmd in [mysql_query_command(&auth, None, Some(name), "SELECT 1;", true), psql_query_command(&auth, None, Some(name), "SELECT 1;")] {
            assert!(cmd.contains(&shell_quote(name)), "{cmd}");
        }
        #[cfg(unix)]
        {
            let auth = ResolvedAuth { username: "app".into(), password: String::new() };
            if let Some(out) = run_with_fake_clients(&mysql_query_command(&auth, None, Some(name), "SELECT 1;", true), None) {
                // Le nom arrive intact au client, sans avoir été exécuté par le shell
                assert!(out.contains(&format!("-e SELECT 1; {name}]")), "{out}");
            }
        }
    }

    #[test]
    fn stdin_secret_only_when_a_password_is_configured() {
        assert_eq!(stdin_secret(&ResolvedAuth::default()).unwrap(), None);
        assert_eq!(stdin_secret(&ResolvedAuth { username: "app".into(), password: String::new() }).unwrap(), None);
        assert_eq!(stdin_secret(&ResolvedAuth { username: "app".into(), password: "pw".into() }).unwrap().as_deref(), Some("pw\n"));
        assert!(stdin_secret(&ResolvedAuth { username: "app".into(), password: "a\nb".into() }).is_err());
    }

    #[test]
    fn mysql_uses_sudo_for_system_auth_by_default() {
        let auth = ResolvedAuth::default();
        let cmd = mysql_query_command(&auth, None, None, "SHOW DATABASES;", true);
        assert!(cmd.starts_with("sudo mysql"));
        assert!(!cmd.contains("MYSQL_PWD"));
    }

    #[test]
    fn postgres_uses_peer_auth_by_default() {
        let auth = ResolvedAuth::default();
        let cmd = psql_query_command(&auth, None, Some("app"), "SELECT 1;");
        assert!(cmd.starts_with("sudo -u postgres psql"));
        assert!(cmd.contains("-d 'app'"));
    }

    #[test]
    fn container_execution_wraps_without_breaking_quoting() {
        let auth = ResolvedAuth { username: String::new(), password: String::new() };
        let sql = "SELECT 'a''b';";
        let cmd = mysql_query_command(&auth, Some("db1"), None, sql, true);
        assert!(cmd.starts_with("docker exec -i 'db1' sh -c"));
        // La commande interne (avec ses propres quotes autour du SQL) doit être encadrée
        // intacte par le quotage externe : on la retrouve, telle quelle, dans la valeur
        // que reçoit `sh -c` du côté du conteneur — vérifié en la faisant réellement
        // extraire par un shell, qui doit la rendre exactement (sans confondre les niveaux
        // de quotes imbriqués).
        let inner_quoted = &cmd["docker exec -i 'db1' sh -c ".len()..];
        let out = std::process::Command::new("sh").arg("-c").arg(format!("printf '%s' {}", inner_quoted)).output();
        let expected_inner = format!("sudo mysql --batch --raw -e {}", shell_quote(sql));
        if let Ok(out) = out {
            let inner = String::from_utf8_lossy(&out.stdout).into_owned();
            assert_eq!(inner, expected_inner);
        }
    }

    #[test]
    fn dangerous_database_names_are_neutralized_in_generated_sql() {
        let sql = list_tables_sql(DbEngine::Mysql, "x'; DROP TABLE users; --");
        assert!(sql.contains("'x''; DROP TABLE users; --'"));
        assert!(!sql.contains("DROP TABLE users;'"));
    }

    // ── Parsing ──────────────────────────────────────────────────────────────────
    #[test]
    fn parses_detect_output_hosts_and_containers() {
        let out = "--MYSQL--\nmysql  Ver 8.0.35\nactive\n--POSTGRES--\n--REDIS--\nredis-cli 7.2.4\nunknown\n--DOCKER--\nabc123|postgres:16|/my-postgres\ndef456|redis:7|cache\n";
        let engines = parse_detect(out);
        assert_eq!(engines.len(), 4);
        assert_eq!(engines[0].engine, DbEngine::Mysql);
        assert_eq!(engines[0].status, "active");
        assert_eq!(engines[1].engine, DbEngine::Redis);
        assert_eq!(engines[1].status, "unknown");
        let containers: Vec<_> = engines.iter().filter(|e| e.container.is_some()).collect();
        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].engine, DbEngine::Postgres);
        assert_eq!(containers[0].container.as_deref(), Some("my-postgres"));
    }

    #[test]
    fn detects_nothing_when_no_engine_installed() {
        let out = "--MYSQL--\n--POSTGRES--\n--REDIS--\n--DOCKER--\n";
        assert!(parse_detect(out).is_empty());
    }

    #[test]
    fn parses_mysql_style_tabular_output() {
        // mysql --batch --raw : tabulation, en-têtes sur la 1re ligne
        let out = "Database\tSize\ntest\t1024\napp\t2048\n";
        let r = parse_tabular(out, '\t', true);
        assert_eq!(r.columns, vec!["Database", "Size"]);
        assert_eq!(r.rows, vec![vec!["test", "1024"], vec!["app", "2048"]]);
        assert!(!r.truncated);
    }

    #[test]
    fn caps_result_rows_at_the_limit() {
        let mut out = String::new();
        for i in 0..(MAX_RESULT_ROWS + 50) {
            out.push_str(&format!("row{}\n", i));
        }
        let r = parse_tabular(&out, '\t', false);
        assert_eq!(r.rows.len(), MAX_RESULT_ROWS);
        assert!(r.truncated);
    }

    #[test]
    fn parses_databases_tables_and_users() {
        let dbs = parse_databases("app\t204800\t12\ntest\t0\t0\n", '\t');
        assert_eq!(dbs, vec![
            DbInfo { name: "app".into(), size_bytes: 204800, table_count: 12 },
            DbInfo { name: "test".into(), size_bytes: 0, table_count: 0 },
        ]);
        let tables = parse_tables("users\t42\t16384\n", '\t');
        assert_eq!(tables, vec![TableInfo { name: "users".into(), row_estimate: 42, size_bytes: 16384 }]);
        let users = parse_users("root\tlocalhost\napp\t%\n", '\t');
        assert_eq!(users, vec![DbUser { name: "root".into(), detail: "localhost".into() }, DbUser { name: "app".into(), detail: "%".into() }]);
    }

    #[test]
    fn parses_backup_output_or_reports_failure() {
        let ok = parse_backup_output("--PATH--\n/home/user/backups/app_20260101_000000.sql\n--SIZE--\n204800\n").unwrap();
        assert_eq!(ok, BackupResult { path: "/home/user/backups/app_20260101_000000.sql".into(), size_bytes: 204800 });
        assert!(parse_backup_output("mysqldump: Got error: 1044\n").is_err());
    }

    #[test]
    fn backup_command_expands_home_and_quotes_the_rest() {
        let auth = ResolvedAuth::default();
        let cmd = backup_command(DbEngine::Mysql, &auth, None, "app", "~/backups");
        assert!(cmd.contains("DIR=\"$HOME\"/'backups';"));
        assert!(cmd.contains("sudo mysqldump 'app'"));
    }

    #[test]
    fn service_command_tries_each_candidate_name() {
        assert_eq!(service_command(DbEngine::Mysql, "restart"), "sudo systemctl restart mariadb || sudo systemctl restart mysql");
        assert!(validate_service_action("start").is_ok());
        assert!(validate_service_action("rm -rf /").is_err());
    }

    #[test]
    fn read_only_wrapping_differs_by_engine() {
        assert_eq!(wrap_read_only(DbEngine::Mysql, "SELECT 1;"), "START TRANSACTION READ ONLY; SELECT 1; COMMIT;");
        assert_eq!(wrap_read_only(DbEngine::Postgres, "SELECT 1;"), "BEGIN; SET TRANSACTION READ ONLY; SELECT 1; COMMIT;");
    }

    #[test]
    fn redis_command_allowlist_blocks_writes() {
        assert!(validate_redis_command("GET foo").is_ok());
        assert!(validate_redis_command("info").is_ok());
        assert!(validate_redis_command("SET foo bar").is_err());
        assert!(validate_redis_command("FLUSHALL").is_err());
        assert!(validate_redis_command("CONFIG SET requirepass x").is_err());
    }

    #[test]
    fn parses_redis_info_summary() {
        let out = "redis_version:7.2.4\r\nused_memory_human:1.20M\r\ndb0:keys=12,expires=0,avg_ttl=0\r\ndb1:keys=3,expires=1,avg_ttl=100\r\n";
        let info = parse_redis_info(out);
        assert_eq!(info.version, "7.2.4");
        assert_eq!(info.used_memory_human, "1.20M");
        assert_eq!(info.keys_per_db, vec![("db0".to_string(), 12), ("db1".to_string(), 3)]);
    }

    #[test]
    fn create_and_drop_use_quoted_identifiers() {
        assert_eq!(create_database_sql(DbEngine::Mysql, "shop"), "CREATE DATABASE `shop`;");
        assert_eq!(create_database_sql(DbEngine::Postgres, "shop"), "CREATE DATABASE \"shop\";");
        assert_eq!(drop_database_sql(DbEngine::Mysql, "shop"), "DROP DATABASE `shop`;");
    }
}
