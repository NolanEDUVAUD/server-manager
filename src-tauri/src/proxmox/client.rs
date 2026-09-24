use crate::proxmox::models::{ProxmoxNode, ProxmoxSnapshot, ProxmoxVm, VmAction, VmType};
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

#[derive(Debug, Deserialize)]
struct RawVm {
    vmid: u32,
    #[serde(default)]
    name: Option<String>,
    status: String,
    #[serde(default)]
    cpu: f64,
    #[serde(default)]
    mem: u64,
    #[serde(default)]
    maxmem: u64,
    #[serde(default)]
    disk: u64,
    #[serde(default)]
    maxdisk: u64,
}

#[derive(Debug, Deserialize)]
struct RawSnapshot {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    snaptime: Option<u64>,
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

    async fn list_vms_of_type(&self, node: &str, vm_type: VmType) -> Result<Vec<ProxmoxVm>, String> {
        let path = format!("/nodes/{}/{}", node, vm_type.api_segment());
        let raw: Vec<RawVm> = self.get_json(&path).await?;
        Ok(raw
            .into_iter()
            .map(|v| ProxmoxVm {
                vmid: v.vmid,
                name: v.name.unwrap_or_else(|| format!("vm-{}", v.vmid)),
                node: node.to_string(),
                vm_type,
                status: v.status,
                cpu: v.cpu,
                mem: v.mem,
                maxmem: v.maxmem,
                disk: v.disk,
                maxdisk: v.maxdisk,
            })
            .collect())
    }

    pub async fn list_all_vms(&self) -> Result<Vec<ProxmoxVm>, String> {
        let nodes = self.list_nodes().await?;
        let mut all = Vec::new();
        for node in &nodes {
            let mut qemu = self.list_vms_of_type(&node.node, VmType::Qemu).await?;
            let mut lxc = self.list_vms_of_type(&node.node, VmType::Lxc).await?;
            all.append(&mut qemu);
            all.append(&mut lxc);
        }
        Ok(all)
    }

    pub async fn vm_action(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
        action: VmAction,
    ) -> Result<String, String> {
        let path = format!(
            "/nodes/{}/{}/{}/status/{}",
            node,
            vm_type.api_segment(),
            vmid,
            action.api_segment()
        );
        self.post_form(&path, &[]).await
    }

    pub async fn list_snapshots(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
    ) -> Result<Vec<ProxmoxSnapshot>, String> {
        let path = format!("/nodes/{}/{}/{}/snapshot", node, vm_type.api_segment(), vmid);
        let raw: Vec<RawSnapshot> = self.get_json(&path).await?;
        Ok(raw
            .into_iter()
            .filter(|s| s.name != "current")
            .map(|s| ProxmoxSnapshot {
                name: s.name,
                description: s.description.unwrap_or_default(),
                snaptime: s.snaptime,
            })
            .collect())
    }

    pub async fn create_snapshot(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
        name: &str,
    ) -> Result<String, String> {
        let path = format!("/nodes/{}/{}/{}/snapshot", node, vm_type.api_segment(), vmid);
        self.post_form(&path, &[("snapname", name)]).await
    }

    pub async fn rollback_snapshot(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
        name: &str,
    ) -> Result<String, String> {
        let path = format!(
            "/nodes/{}/{}/{}/snapshot/{}/rollback",
            node,
            vm_type.api_segment(),
            vmid,
            name
        );
        self.post_form(&path, &[]).await
    }

    pub async fn clone_vm(
        &self,
        node: &str,
        vmid: u32,
        vm_type: VmType,
        new_name: &str,
    ) -> Result<String, String> {
        let next_id: String = self.get_json("/cluster/nextid").await?;
        let path = format!("/nodes/{}/{}/{}/clone", node, vm_type.api_segment(), vmid);
        self.post_form(&path, &[("newid", next_id.as_str()), ("name", new_name)])
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proxmox::models::VmType;
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

    #[tokio::test]
    async fn list_all_vms_combines_qemu_and_lxc_across_nodes() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/api2/json/nodes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [{"node": "pve1", "status": "online"}]
            })))
            .mount(&server).await;
        Mock::given(method("GET")).and(path("/api2/json/nodes/pve1/qemu"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [{"vmid": 100, "name": "web01", "status": "running", "cpu": 0.05, "mem": 536870912i64, "maxmem": 1073741824i64, "disk": 0, "maxdisk": 8589934592i64}]
            })))
            .mount(&server).await;
        Mock::given(method("GET")).and(path("/api2/json/nodes/pve1/lxc"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [{"vmid": 200, "name": "ct01", "status": "stopped", "cpu": 0.0, "mem": 0, "maxmem": 536870912i64, "disk": 104857600i64, "maxdisk": 2147483648i64}]
            })))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let vms = client.list_all_vms().await.unwrap();

        assert_eq!(vms.len(), 2);
        let qemu_vm = vms.iter().find(|v| v.vm_type == VmType::Qemu).unwrap();
        assert_eq!(qemu_vm.vmid, 100);
        assert_eq!(qemu_vm.name, "web01");
        assert_eq!(qemu_vm.node, "pve1");
        let lxc_vm = vms.iter().find(|v| v.vm_type == VmType::Lxc).unwrap();
        assert_eq!(lxc_vm.vmid, 200);
        assert_eq!(lxc_vm.status, "stopped");
    }

    #[tokio::test]
    async fn vm_action_calls_correct_endpoint_for_qemu_and_lxc() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/status/start"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:qemu-start"})))
            .mount(&server).await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/lxc/200/status/stop"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:lxc-stop"})))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();

        let upid_start = client.vm_action("pve1", 100, VmType::Qemu, VmAction::Start).await.unwrap();
        assert_eq!(upid_start, "UPID:pve1:qemu-start");

        let upid_stop = client.vm_action("pve1", 200, VmType::Lxc, VmAction::Stop).await.unwrap();
        assert_eq!(upid_stop, "UPID:pve1:lxc-stop");
    }

    #[tokio::test]
    async fn vm_action_propagates_proxmox_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/status/stop"))
            .respond_with(ResponseTemplate::new(500).set_body_string("VM already stopped"))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let result = client.vm_action("pve1", 100, VmType::Qemu, VmAction::Stop).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn list_snapshots_excludes_current_pseudo_snapshot() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/api2/json/nodes/pve1/qemu/100/snapshot"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "data": [
                    {"name": "current"},
                    {"name": "before-update", "description": "avant mise à jour", "snaptime": 1700000000}
                ]
            })))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let snaps = client.list_snapshots("pve1", 100, VmType::Qemu).await.unwrap();

        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].name, "before-update");
        assert_eq!(snaps[0].description, "avant mise à jour");
    }

    #[tokio::test]
    async fn create_snapshot_sends_snapname_form_field() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/snapshot"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:snap-create"})))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let upid = client.create_snapshot("pve1", 100, VmType::Qemu, "before-update").await.unwrap();
        assert_eq!(upid, "UPID:pve1:snap-create");
    }

    #[tokio::test]
    async fn rollback_snapshot_calls_rollback_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/snapshot/before-update/rollback"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:snap-rollback"})))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let upid = client.rollback_snapshot("pve1", 100, VmType::Qemu, "before-update").await.unwrap();
        assert_eq!(upid, "UPID:pve1:snap-rollback");
    }

    #[tokio::test]
    async fn clone_vm_fetches_nextid_then_clones() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/api2/json/cluster/nextid"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "105"})))
            .mount(&server).await;
        Mock::given(method("POST")).and(path("/api2/json/nodes/pve1/qemu/100/clone"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"data": "UPID:pve1:clone"})))
            .mount(&server).await;

        let client = ProxmoxClient::new(&server.uri(), "root@pam!sm", "secret", true, 5).unwrap();
        let upid = client.clone_vm("pve1", 100, VmType::Qemu, "web01-clone").await.unwrap();
        assert_eq!(upid, "UPID:pve1:clone");
    }
}
