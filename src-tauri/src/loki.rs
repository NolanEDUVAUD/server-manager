/// Visionneuse de logs Loki : construction de requêtes LogQL et lecture des résultats
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogEntry {
    /// Horodatage en millisecondes
    pub ts: i64,
    pub line: String,
    pub unit: String,
    /// Priorité syslog (0 = urgence … 7 = debug)
    pub priority: Option<u8>,
}

/// Échappe une chaîne pour un littéral LogQL entre guillemets
fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Requête LogQL : hôte, priorité maximale (ex. 4 = avertissements et plus grave),
/// unité systemd, texte recherché (insensible à la casse)
pub fn build_query(host: &str, max_priority: Option<u8>, unit: Option<&str>, text: Option<&str>) -> String {
    let mut selector = format!("host=\"{}\"", esc(host));
    if let Some(p) = max_priority.filter(|p| *p < 7) {
        selector.push_str(&format!(", priority=~\"[0-{}]\"", p));
    }
    if let Some(u) = unit.map(str::trim).filter(|u| !u.is_empty()) {
        selector.push_str(&format!(", unit=\"{}\"", esc(u)));
    }
    let mut q = format!("{{{}}}", selector);
    if let Some(t) = text.map(str::trim).filter(|t| !t.is_empty()) {
        // (?i) : recherche insensible à la casse ; le texte est échappé pour la regex
        let re: String = t.chars().map(|c| if "\\.+*?()|[]{}^$".contains(c) { format!("\\\\{}", c) } else { c.to_string() }).collect();
        q.push_str(&format!(" |~ \"(?i){}\"", re.replace('"', "\\\"")));
    }
    q
}

/// Réponse de /loki/api/v1/query_range → entrées, de la plus récente à la plus ancienne
pub fn parse_range(resp: &Value) -> Result<Vec<LogEntry>, String> {
    if resp["status"] != "success" {
        return Err(resp["error"].as_str().or(resp["message"].as_str()).unwrap_or("Réponse Loki invalide").to_string());
    }
    let mut out = Vec::new();
    for stream in resp["data"]["result"].as_array().cloned().unwrap_or_default() {
        let labels = &stream["stream"];
        let unit = labels["unit"].as_str().unwrap_or("").to_string();
        let priority = labels["priority"].as_str().and_then(|p| p.parse().ok());
        for v in stream["values"].as_array().cloned().unwrap_or_default() {
            let ns: i64 = v[0].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
            out.push(LogEntry { ts: ns / 1_000_000, line: v[1].as_str().unwrap_or("").to_string(), unit: unit.clone(), priority });
        }
    }
    out.sort_by(|a, b| b.ts.cmp(&a.ts));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn query_building() {
        assert_eq!(build_query("minipc", None, None, None), "{host=\"minipc\"}");
        assert_eq!(build_query("minipc", Some(4), Some("pveproxy.service"), None), "{host=\"minipc\", priority=~\"[0-4]\", unit=\"pveproxy.service\"}");
        // Priorité 7 = tout : pas de filtre
        assert_eq!(build_query("h", Some(7), None, None), "{host=\"h\"}");
    }

    #[test]
    fn text_is_escaped_and_case_insensitive() {
        assert_eq!(build_query("h", None, None, Some("a.b \"x\"")), "{host=\"h\"} |~ \"(?i)a\\\\.b \\\"x\\\"\"");
        assert_eq!(build_query("h\"}", None, None, None), "{host=\"h\\\"}\"}");
    }

    /// Format réel de Loki (docker-host, 2026-09-25)
    #[test]
    fn parses_streams_newest_first() {
        let resp = json!({"status":"success","data":{"resultType":"streams","result":[
            {"stream":{"host":"docker-host","priority":"6","unit":"qemu-guest-agent.service"},
             "values":[["1790344415576118000","info: guest-ping called"],["1790344400000000000","older"]]},
            {"stream":{"host":"docker-host","priority":"3","unit":"docker.service"},
             "values":[["1790344410000000000","error: failed"]]}
        ]}});
        let e = parse_range(&resp).unwrap();
        assert_eq!(e.iter().map(|x| x.line.as_str()).collect::<Vec<_>>(), vec!["info: guest-ping called", "error: failed", "older"]);
        assert_eq!(e[0].ts, 1790344415576);
        assert_eq!(e[1].priority, Some(3));
        assert_eq!(e[1].unit, "docker.service");
    }

    #[test]
    fn loki_error_is_reported() {
        assert!(parse_range(&json!({"status":"error","error":"parse error"})).unwrap_err().contains("parse error"));
    }
}
