/// Console SSH — table des sessions interactives ouvertes
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::UnboundedSender;

/// Messages envoyés par le frontend à la tâche qui porte une session SSH.
#[derive(Debug, PartialEq)]
pub enum TerminalInput {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

/// Table partagée (Arc) : la tâche d'une session doit pouvoir s'en retirer
/// elle-même quand la connexion se termine, sans passer par une commande.
#[derive(Default, Clone)]
pub struct TerminalState {
    sessions: Arc<Mutex<HashMap<String, UnboundedSender<TerminalInput>>>>,
}

impl TerminalState {
    pub fn insert(&self, id: String, tx: UnboundedSender<TerminalInput>) -> Result<(), String> {
        self.lock()?.insert(id, tx);
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<Option<UnboundedSender<TerminalInput>>, String> {
        Ok(self.lock()?.remove(id))
    }

    /// Transmet une entrée à la session ; erreur si elle n'existe plus.
    pub fn send(&self, id: &str, input: TerminalInput) -> Result<(), String> {
        let sessions = self.lock()?;
        let tx = sessions.get(id).ok_or_else(|| format!("Session terminée ou introuvable : {}", id))?;
        tx.send(input).map_err(|_| format!("Session terminée : {}", id))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, UnboundedSender<TerminalInput>>>, String> {
        self.sessions.lock().map_err(|e| format!("Erreur mutex: {}", e))
    }
}

/// Borne les dimensions reçues du frontend avant de les transmettre au serveur SSH.
pub fn validate_size(cols: u32, rows: u32) -> Result<(u32, u32), String> {
    if (1..=1000).contains(&cols) && (1..=1000).contains(&rows) {
        Ok((cols, rows))
    } else {
        Err(format!("Dimensions de terminal invalides : {}x{}", cols, rows))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn validate_size_bounds() {
        assert_eq!(validate_size(80, 24), Ok((80, 24)));
        assert!(validate_size(0, 24).is_err());
        assert!(validate_size(80, 1001).is_err());
    }

    #[test]
    fn send_reaches_the_session() {
        let state = TerminalState::default();
        let (tx, mut rx) = unbounded_channel();
        state.insert("s1".into(), tx).unwrap();

        state.send("s1", TerminalInput::Data(b"ls\n".to_vec())).unwrap();

        assert_eq!(rx.try_recv().unwrap(), TerminalInput::Data(b"ls\n".to_vec()));
    }

    #[test]
    fn send_to_unknown_or_removed_session_fails() {
        let state = TerminalState::default();
        let (tx, _rx) = unbounded_channel();
        state.insert("s1".into(), tx).unwrap();
        // Un clone partage la même table : c'est ce qu'utilise la tâche de session
        state.clone().remove("s1").unwrap();

        assert!(state.send("s1", TerminalInput::Close).is_err());
        assert!(state.send("inconnue", TerminalInput::Close).is_err());
    }

    #[test]
    fn send_fails_when_session_task_is_gone() {
        let state = TerminalState::default();
        let (tx, rx) = unbounded_channel();
        state.insert("s1".into(), tx).unwrap();
        drop(rx);

        assert!(state.send("s1", TerminalInput::Close).is_err());
    }
}
