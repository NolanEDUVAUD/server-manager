use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Webview, Wry};

#[derive(Default)]
pub struct DashboardState {
    pub webviews: Mutex<HashMap<String, Webview<Wry>>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_has_no_webviews() {
        let state = DashboardState::default();
        assert!(state.webviews.lock().unwrap().is_empty());
    }
}
