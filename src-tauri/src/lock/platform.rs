//! Intégrations Windows du verrouillage : Windows Hello (UserConsentVerifier) et
//! état de la session (WTS). Hors Windows : Hello indisponible et aucune détection
//! du verrouillage de session (le reste du verrouillage fonctionne normalement).

/// Résultat d'une vérification Windows Hello
#[derive(Debug, Clone, PartialEq, Eq)]
// Hors Windows, seule la variante `Failed` est produite
#[cfg_attr(not(windows), allow(dead_code))]
pub enum HelloOutcome {
    Verified,
    Canceled,
    Failed(String),
}

/// Le verrouillage de la session est-il détectable sur cette plateforme ?
pub const SESSION_DETECTION: bool = cfg!(windows);

#[cfg(windows)]
mod imp {
    use super::HelloOutcome;
    use windows::core::{factory, HSTRING, PWSTR};
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::RemoteDesktop::{
        WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW, WTS_CURRENT_SERVER_HANDLE,
        WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
    };
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
    use windows_future::IAsyncOperation;

    /// Windows Hello configuré et utilisable. Appel bloquant (quelques dizaines de ms).
    pub fn hello_available() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.get())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }

    /// Vérification Windows Hello rattachée à la fenêtre `hwnd` : l'invite s'affiche
    /// devant l'app et non derrière. Appel bloquant, à lancer hors du thread principal
    /// (la boucle de messages de la fenêtre doit rester libre).
    pub fn hello_verify(hwnd: isize, message: &str) -> HelloOutcome {
        let request = || -> windows::core::Result<UserConsentVerificationResult> {
            // L'interop Win32 permet de passer le HWND, ce que l'API WinRT seule ne fait pas
            let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
            // SAFETY : `hwnd` est le handle de la fenêtre principale, vivante pendant l'appel
            let op: IAsyncOperation<UserConsentVerificationResult> = unsafe {
                interop.RequestVerificationForWindowAsync(HWND(hwnd as *mut core::ffi::c_void), &HSTRING::from(message))?
            };
            op.get()
        };
        match request() {
            Ok(UserConsentVerificationResult::Verified) => HelloOutcome::Verified,
            Ok(UserConsentVerificationResult::Canceled) => HelloOutcome::Canceled,
            Ok(other) => HelloOutcome::Failed(describe(other).to_string()),
            Err(e) => HelloOutcome::Failed(format!("Windows Hello indisponible : {}", e.message())),
        }
    }

    fn describe(result: UserConsentVerificationResult) -> &'static str {
        match result {
            UserConsentVerificationResult::DeviceNotPresent => "Aucun dispositif Windows Hello détecté : utilise le PIN",
            UserConsentVerificationResult::NotConfiguredForUser => "Windows Hello n'est pas configuré pour cet utilisateur : utilise le PIN",
            UserConsentVerificationResult::DisabledByPolicy => "Windows Hello est désactivé par une stratégie : utilise le PIN",
            UserConsentVerificationResult::DeviceBusy => "Le dispositif Windows Hello est occupé, réessaie",
            UserConsentVerificationResult::RetriesExhausted => "Trop d'essais Windows Hello : utilise le PIN",
            _ => "Vérification Windows Hello refusée",
        }
    }

    /// La session Windows courante est-elle verrouillée ? None = état inconnu.
    /// Remarque : Windows 7 inverse LOCK / UNLOCK dans SessionFlags (non géré,
    /// l'app cible Windows 10 et 11).
    pub fn session_locked() -> Option<bool> {
        let mut buffer = PWSTR::null();
        let mut bytes = 0u32;
        // SAFETY : WTS alloue le tampon, libéré par WTSFreeMemory ci-dessous
        unsafe {
            WTSQuerySessionInformationW(
                Some(WTS_CURRENT_SERVER_HANDLE),
                WTS_CURRENT_SESSION,
                WTSSessionInfoEx,
                &mut buffer,
                &mut bytes,
            )
        }
        .ok()?;
        if buffer.is_null() {
            return None;
        }
        let state = if bytes as usize >= std::mem::size_of::<WTSINFOEXW>() {
            // SAFETY : pour WTSSessionInfoEx, le tampon contient un WTSINFOEXW (taille vérifiée)
            let info = unsafe { &*(buffer.0 as *const WTSINFOEXW) };
            if info.Level == 1 {
                // SAFETY : Level == 1 ⇒ la variante WTSInfoExLevel1 de l'union est valide
                let flags = unsafe { info.Data.WTSInfoExLevel1.SessionFlags };
                Some(flags == WTS_SESSIONSTATE_LOCK as i32)
            } else {
                None
            }
        } else {
            None
        };
        // SAFETY : tampon alloué par WTSQuerySessionInformationW, libéré une seule fois
        unsafe { WTSFreeMemory(buffer.0 as *mut core::ffi::c_void) };
        state
    }
}

#[cfg(not(windows))]
mod imp {
    use super::HelloOutcome;

    pub fn hello_available() -> bool {
        false
    }

    pub fn hello_verify(_hwnd: isize, _message: &str) -> HelloOutcome {
        HelloOutcome::Failed("Windows Hello n'est disponible que sous Windows".to_string())
    }

    /// Pas de détection hors Windows : le verrouillage de session est ignoré
    pub fn session_locked() -> Option<bool> {
        None
    }
}

pub use imp::{hello_available, hello_verify, session_locked};

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn fallback_has_no_hello_nor_session_detection() {
        assert!(!hello_available());
        assert!(matches!(hello_verify(0, "x"), HelloOutcome::Failed(_)));
        assert_eq!(session_locked(), None);
    }
}
