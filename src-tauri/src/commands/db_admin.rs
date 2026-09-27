/// Commandes Tauri — Administration des bases de données (MySQL/MariaDB, PostgreSQL,
/// Redis) sur les serveurs, via SSH (ou `docker exec` pour un moteur conteneurisé).
use tauri::State;

use crate::{
    commands::ssh::{execute_ssh, execute_ssh_with_stdin},
    models::SshResult,
    crypto,
    db_admin::{
        self, backup_command, backup_dir_for, create_database_sql, drop_database_sql, list_databases_sql, list_tables_sql, list_users_sql, mysql_query_command,
        parse_backup_output, parse_databases, parse_detect, parse_redis_info, parse_tables, parse_users, psql_query_command, redis_command, resolve_auth,
        service_command, stdin_secret, validate_identifier, validate_redis_command, validate_service_action, wrap_read_only, BackupResult, DbConnectionPayload, DbConnectionView,
        DbEngine, DbInfo, DbUser, DetectedEngine, QueryResult, RedisInfo, ResolvedAuth, TableInfo, MAX_OUTPUT_BYTES,
    },
    docker::validate_container_ref,
    ssh_auth::{resolve_ssh, SshTarget},
    storage::AppState,
};

/// Exécute une commande de base de données : un mot de passe applicatif éventuel est
/// transmis sur l'entrée standard, jamais dans la commande (voir `db_admin::password_prelude`)
async fn execute_db(target: &SshTarget, command: &str, timeout: u64, auth: &ResolvedAuth) -> Result<SshResult, String> {
    match stdin_secret(auth)? {
        Some(secret) => execute_ssh_with_stdin(target, command, secret.as_bytes(), timeout).await,
        None => execute_ssh(target, command, timeout).await,
    }
}

/// Cible SSH d'un serveur et son timeout, sous le même verrou (voir `commands::docker`)
fn ssh_params(state: &AppState, server_id: &str) -> Result<(SshTarget, u64), String> {
    crypto::ensure_unlocked()?;
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    if !data.servers.iter().any(|s| s.id == server_id) {
        return Err(format!("Serveur introuvable: {}", server_id));
    }
    Ok((resolve_ssh(&data, server_id)?, data.settings.network.ssh_timeout_secs.min(30)))
}

fn container_ref(container: &Option<String>) -> Result<Option<&str>, String> {
    match container {
        Some(c) => {
            validate_container_ref(c)?;
            Ok(Some(c.as_str()))
        }
        None => Ok(None),
    }
}

fn check_output_size(output: &str) -> Result<(), String> {
    if output.len() > MAX_OUTPUT_BYTES {
        return Err(format!("Résultat trop volumineux (> {} Mo) : affine ta requête", MAX_OUTPUT_BYTES / 1_000_000));
    }
    Ok(())
}

// ── Connexions (identifiants applicatifs) ───────────────────────────────────────────────
#[tauri::command]
pub fn get_db_connections(state: State<AppState>, server_id: String) -> Result<Vec<DbConnectionView>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.db_connections.iter().filter(|c| c.server_id == server_id).map(DbConnectionView::from).collect())
}

#[tauri::command]
pub fn save_db_connection(state: State<AppState>, payload: DbConnectionPayload) -> Result<DbConnectionView, String> {
    let view = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let key = crypto::data_key(&data)?;
        db_admin::apply_connection_payload(&mut data.db_connections, payload, &key)?
    };
    state.save()?;
    Ok(view)
}

// ── Détection ────────────────────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn db_detect_engines(state: State<'_, AppState>, server_id: String) -> Result<Vec<DetectedEngine>, String> {
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let result = execute_ssh(&target, db_admin::DETECT_COMMAND, timeout).await?;
    Ok(parse_detect(&result.output))
}

// ── Bases, tables, utilisateurs ─────────────────────────────────────────────────────────
#[tauri::command]
pub async fn db_list_databases(state: State<'_, AppState>, server_id: String, engine: DbEngine, container: Option<String>) -> Result<Vec<DbInfo>, String> {
    if engine == DbEngine::Redis {
        return Ok(Vec::new());
    }
    let container = container_ref(&container)?;
    let auth = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        resolve_auth(&data, &server_id, engine)?
    };
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let sql = list_databases_sql(engine);
    let command = match engine {
        DbEngine::Mysql => mysql_query_command(&auth, container, None, sql, false),
        DbEngine::Postgres => psql_query_command(&auth, container, None, sql),
        DbEngine::Redis => unreachable!(),
    };
    let result = execute_db(&target, &command, timeout, &auth).await?;
    if !result.success {
        return Err(result.error.unwrap_or(result.output));
    }
    let sep = if engine == DbEngine::Mysql { '\t' } else { '\u{1f}' };
    Ok(parse_databases(&result.output, sep))
}

#[tauri::command]
pub async fn db_list_tables(state: State<'_, AppState>, server_id: String, engine: DbEngine, database: String, container: Option<String>) -> Result<Vec<TableInfo>, String> {
    let container = container_ref(&container)?;
    let auth = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        resolve_auth(&data, &server_id, engine)?
    };
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let sql = list_tables_sql(engine, &database);
    let command = match engine {
        DbEngine::Mysql => mysql_query_command(&auth, container, None, &sql, false),
        DbEngine::Postgres => psql_query_command(&auth, container, Some(&database), &sql),
        DbEngine::Redis => return Ok(Vec::new()),
    };
    let result = execute_db(&target, &command, timeout, &auth).await?;
    if !result.success {
        return Err(result.error.unwrap_or(result.output));
    }
    let sep = if engine == DbEngine::Mysql { '\t' } else { '\u{1f}' };
    Ok(parse_tables(&result.output, sep))
}

#[tauri::command]
pub async fn db_list_users(state: State<'_, AppState>, server_id: String, engine: DbEngine, container: Option<String>) -> Result<Vec<DbUser>, String> {
    if engine == DbEngine::Redis {
        return Ok(Vec::new());
    }
    let container = container_ref(&container)?;
    let auth = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        resolve_auth(&data, &server_id, engine)?
    };
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let sql = list_users_sql(engine);
    let command = match engine {
        DbEngine::Mysql => mysql_query_command(&auth, container, None, sql, false),
        DbEngine::Postgres => psql_query_command(&auth, container, None, sql),
        DbEngine::Redis => unreachable!(),
    };
    let result = execute_db(&target, &command, timeout, &auth).await?;
    if !result.success {
        return Err(result.error.unwrap_or(result.output));
    }
    let sep = if engine == DbEngine::Mysql { '\t' } else { '\u{1f}' };
    Ok(parse_users(&result.output, sep))
}

// ── Requête libre (éditeur SQL) ─────────────────────────────────────────────────────────
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn db_run_query(
    state: State<'_, AppState>,
    server_id: String,
    engine: DbEngine,
    database: Option<String>,
    container: Option<String>,
    sql: String,
    read_only: bool,
) -> Result<QueryResult, String> {
    let container = container_ref(&container)?;
    let auth = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        resolve_auth(&data, &server_id, engine)?
    };
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let effective_sql = if read_only { wrap_read_only(engine, &sql) } else { sql.clone() };
    let command = match engine {
        DbEngine::Mysql => mysql_query_command(&auth, container, database.as_deref(), &effective_sql, true),
        DbEngine::Postgres => psql_query_command(&auth, container, database.as_deref(), &effective_sql),
        DbEngine::Redis => return Err("La console SQL n'est pas disponible pour Redis".into()),
    };
    let result = execute_db(&target, &command, timeout, &auth).await?;
    check_output_size(&result.output)?;
    if !result.success {
        return Err(result.error.unwrap_or(result.output));
    }
    let sep = if engine == DbEngine::Mysql { '\t' } else { '\u{1f}' };
    Ok(db_admin::parse_tabular(&result.output, sep, true))
}

// ── Création / suppression de base ──────────────────────────────────────────────────────
#[tauri::command]
pub async fn db_create_database(state: State<'_, AppState>, server_id: String, engine: DbEngine, container: Option<String>, name: String) -> Result<(), String> {
    validate_identifier(&name)?;
    run_ddl(&state, &server_id, engine, &container, create_database_sql(engine, &name)).await
}

#[tauri::command]
pub async fn db_drop_database(state: State<'_, AppState>, server_id: String, engine: DbEngine, container: Option<String>, name: String) -> Result<(), String> {
    // Le nom peut être celui d'une base existante non créée par l'app (caractères
    // atypiques possibles) : `drop_database_sql` la quote proprement plutôt que de
    // revalider strictement, mais la confirmation (saisie du nom) reste côté frontend.
    if name.is_empty() {
        return Err("Nom de base manquant".into());
    }
    run_ddl(&state, &server_id, engine, &container, drop_database_sql(engine, &name)).await
}

async fn run_ddl(state: &State<'_, AppState>, server_id: &str, engine: DbEngine, container: &Option<String>, sql: String) -> Result<(), String> {
    if sql.is_empty() {
        return Err("Opération non prise en charge pour ce moteur".into());
    }
    let container = container_ref(container)?;
    let auth = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        resolve_auth(&data, server_id, engine)?
    };
    let (target, timeout) = ssh_params(state, server_id)?;
    let command = match engine {
        DbEngine::Mysql => mysql_query_command(&auth, container, None, &sql, false),
        DbEngine::Postgres => psql_query_command(&auth, container, None, &sql),
        DbEngine::Redis => return Err("Opération non prise en charge pour Redis".into()),
    };
    let result = execute_db(&target, &command, timeout, &auth).await?;
    if result.success {
        Ok(())
    } else {
        Err(result.error.unwrap_or(result.output))
    }
}

// ── Sauvegarde ───────────────────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn db_backup_database(state: State<'_, AppState>, server_id: String, engine: DbEngine, container: Option<String>, database: String, dir: Option<String>) -> Result<BackupResult, String> {
    validate_identifier(&database)?;
    let container_val = container.clone();
    let container = container_ref(&container)?;
    let (auth, default_dir) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        (resolve_auth(&data, &server_id, engine)?, backup_dir_for(&data, &server_id, engine))
    };
    let dir = dir.filter(|d| !d.is_empty()).unwrap_or(default_dir);
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let command = backup_command(engine, &auth, container, &database, &dir);
    if command.is_empty() || engine == DbEngine::Redis {
        return Err("Sauvegarde non prise en charge pour Redis".into());
    }
    // Un dump peut prendre plus longtemps qu'une requête ordinaire
    let result = execute_db(&target, &command, timeout.max(120), &auth).await?;
    let _ = &container_val;
    if !result.success {
        return Err(result.error.unwrap_or(result.output));
    }
    parse_backup_output(&result.output)
}

// ── Actions de service ───────────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn db_service_action(state: State<'_, AppState>, server_id: String, engine: DbEngine, action: String) -> Result<(), String> {
    validate_service_action(&action)?;
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let command = service_command(engine, &action);
    let result = execute_ssh(&target, &command, timeout.max(30)).await?;
    if result.success {
        Ok(())
    } else {
        Err(result.error.unwrap_or(result.output))
    }
}

// ── Redis ────────────────────────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn db_redis_info(state: State<'_, AppState>, server_id: String, container: Option<String>) -> Result<RedisInfo, String> {
    let container = container_ref(&container)?;
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let command = redis_command(container, "INFO");
    let result = execute_ssh(&target, &command, timeout).await?;
    if !result.success {
        return Err(result.error.unwrap_or(result.output));
    }
    Ok(parse_redis_info(&result.output))
}

#[tauri::command]
pub async fn db_redis_command(state: State<'_, AppState>, server_id: String, container: Option<String>, command: String) -> Result<String, String> {
    validate_redis_command(&command)?;
    let container = container_ref(&container)?;
    let (target, timeout) = ssh_params(&state, &server_id)?;
    let full = redis_command(container, &command);
    let result = execute_ssh(&target, &full, timeout).await?;
    if !result.success {
        return Err(result.error.unwrap_or(result.output));
    }
    Ok(result.output)
}
