use crate::proxmox::models::ProxmoxNode;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use std::time::Duration;

pub struct ProxmoxClient {
    http: reqwest::Client,
    api_url: String,
    auth_header: String,
}

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
struct RawNode {
    node: String,
    status: String,
}

impl ProxmoxClient {
    pub fn new(
        api_url: &str,
        token_id: &str,
        token_secret: &str,
        verify_tls: bool,
        timeout_secs: u64,
    ) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(!verify_tls)
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| format!("Impossible de créer le client HTTP: {}", e))?;

        Ok(ProxmoxClient {
            http,
            api_url: api_url.trim_end_matches('/').to_string(),
            auth_header: format!("PVEAPIToken={}={}", token_id, token_secret),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api2/json{}", self.api_url, path)
    }

    async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let resp = self
            .http
            .get(self.url(path))
            .header("Authorization", &self.auth_header)
            .send()
            .await
            .map_err(|e| format!("Connexion à Proxmox échouée: {}", e))?;
        let resp = resp
            .error_for_status()
            .map_err(|e| format!("Proxmox a renvoyé une erreur: {}", e))?;
        resp.json::<ApiResponse<T>>()
            .await
            .map(|r| r.data)
            .map_err(|e| format!("Réponse Proxmox invalide: {}", e))
    }

    async fn post_form(&self, path: &str, form: &[(&str, &str)]) -> Result<String, String> {
        let resp = self
            .http
            .post(self.url(path))
            .header("Authorization", &self.auth_header)
            .form(form)
            .send()
            .await
            .map_err(|e| format!("Connexion à Proxmox échouée: {}", e))?;
        let resp = resp
            .error_for_status()
            .map_err(|e| format!("Proxmox a renvoyé une erreur: {}", e))?;
        resp.json::<ApiResponse<String>>()
            .await
            .map(|r| r.data)
            .map_err(|e| format!("Réponse Proxmox invalide: {}", e))
    }

    pub async fn test_connection(&self) -> Result<(), String> {
        self.get_json::<serde_json::Value>("/version").await.map(|_| ())
    }

    pub async fn list_nodes(&self) -> Result<Vec<ProxmoxNode>, String> {
        let raw: Vec<RawNode> = self.get_json("/nodes").await?;
        Ok(raw
            .into_iter()
            .map(|n| ProxmoxNode { node: n.node, status: n.status })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn test_connection_sends_correct_auth_header_and_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api2/json/version"))
            .and(header("Authorization", "PVEAPIToken=root@pam!sm=secret123"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": {"version": "8.1"}})),
            )
            .mount(&server)
            .await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret123", true, 5).unwrap();
        assert!(client.test_connection().await.is_ok());
    }

    #[tokio::test]
    async fn test_connection_fails_on_unauthorized() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api2/json/version"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "wrong", true, 5).unwrap();
        assert!(client.test_connection().await.is_err());
    }

    #[tokio::test]
    async fn list_nodes_parses_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api2/json/nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [{"node": "pve1", "status": "online"}]
            })))
            .mount(&server)
            .await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let nodes = client.list_nodes().await.unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].node, "pve1");
        assert_eq!(nodes[0].status, "online");
    }
}
