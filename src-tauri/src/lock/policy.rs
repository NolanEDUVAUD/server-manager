//! Règles pures du verrouillage : format du PIN et du mot de passe maître,
//! limitation des essais et minuterie d'inactivité. L'horloge est injectée
//! (millisecondes) pour que ces machines d'états soient testables.

pub const PIN_MIN_LEN: usize = 4;
pub const PIN_MAX_LEN: usize = 12;
pub const MASTER_PASSWORD_MIN_LEN: usize = 8;
pub const MASTER_PASSWORD_MAX_LEN: usize = 256;
/// Délai d'inactivité maximal réglable : 24 h
pub const IDLE_MAX_MINUTES: u32 = 24 * 60;

/// Échecs tolérés avant le premier délai
pub const FREE_ATTEMPTS: u32 = 3;
pub const BASE_DELAY_MS: u64 = 5_000;
pub const MAX_DELAY_MS: u64 = 5 * 60_000;

pub fn validate_pin(pin: &str) -> Result<(), String> {
    let len = pin.chars().count();
    if (PIN_MIN_LEN..=PIN_MAX_LEN).contains(&len) && pin.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(format!("Le PIN doit comporter de {} à {} chiffres", PIN_MIN_LEN, PIN_MAX_LEN))
    }
}

pub fn validate_master_password(password: &str) -> Result<(), String> {
    let len = password.chars().count();
    if len < MASTER_PASSWORD_MIN_LEN || password.trim().is_empty() {
        Err(format!("Le mot de passe maître doit comporter au moins {} caractères", MASTER_PASSWORD_MIN_LEN))
    } else if len > MASTER_PASSWORD_MAX_LEN {
        Err(format!("Le mot de passe maître ne peut pas dépasser {} caractères", MASTER_PASSWORD_MAX_LEN))
    } else {
        Ok(())
    }
}

pub fn validate_idle_minutes(minutes: u32) -> Result<(), String> {
    if minutes <= IDLE_MAX_MINUTES {
        Ok(())
    } else {
        Err(format!("Délai d'inactivité : de 0 (jamais) à {} minutes", IDLE_MAX_MINUTES))
    }
}

/// Délai imposé après `failures` échecs consécutifs : aucun pour les premiers
/// essais, puis 5 s, 10 s, 20 s… plafonné à 5 min.
pub fn delay_after(failures: u32) -> u64 {
    if failures < FREE_ATTEMPTS {
        return 0;
    }
    let doublings = (failures - FREE_ATTEMPTS).min(16);
    BASE_DELAY_MS.saturating_mul(1u64 << doublings).min(MAX_DELAY_MS)
}

/// Limitation des essais (PIN, mot de passe maître, secret actuel)
#[derive(Debug, Default, Clone, PartialEq)]
pub struct AttemptLimiter {
    failures: u32,
    blocked_until_ms: u64,
}

impl AttemptLimiter {
    #[cfg(test)]
    pub fn failures(&self) -> u32 {
        self.failures
    }

    /// Temps d'attente restant avant le prochain essai (0 = essai possible)
    pub fn retry_after_ms(&self, now_ms: u64) -> u64 {
        self.blocked_until_ms.saturating_sub(now_ms)
    }

    pub fn check(&self, now_ms: u64) -> Result<(), String> {
        match self.retry_after_ms(now_ms) {
            0 => Ok(()),
            wait => Err(format!("Trop d'essais : réessaie dans {} s", wait.div_ceil(1000))),
        }
    }

    pub fn record_failure(&mut self, now_ms: u64) {
        self.failures = self.failures.saturating_add(1);
        self.blocked_until_ms = now_ms.saturating_add(delay_after(self.failures));
    }

    pub fn record_success(&mut self) {
        *self = Self::default();
    }
}

/// Minuterie d'inactivité : dernière activité connue, et expiration selon le délai
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IdleTimer {
    last_activity_ms: u64,
}

impl IdleTimer {
    pub fn new(now_ms: u64) -> Self {
        IdleTimer { last_activity_ms: now_ms }
    }

    pub fn touch(&mut self, now_ms: u64) {
        self.last_activity_ms = now_ms;
    }

    /// Délai écoulé sans activité ? `idle_minutes` = 0 : jamais.
    pub fn expired(&self, idle_minutes: u32, now_ms: u64) -> bool {
        idle_minutes > 0 && now_ms.saturating_sub(self.last_activity_ms) >= u64::from(idle_minutes) * 60_000
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_format() {
        for ok in ["0000", "4821", "123456789012"] {
            assert!(validate_pin(ok).is_ok(), "{}", ok);
        }
        for bad in ["", "123", "1234567890123", "12a4", " 1234", "12 34", "١٢٣٤", "-123"] {
            assert!(validate_pin(bad).is_err(), "{:?}", bad);
        }
    }

    #[test]
    fn master_password_format() {
        assert!(validate_master_password("court").is_err());
        assert!(validate_master_password("        ").is_err());
        assert!(validate_master_password("un mot de passe").is_ok());
        assert!(validate_master_password(&"é".repeat(256)).is_ok());
        assert!(validate_master_password(&"x".repeat(257)).is_err());
    }

    #[test]
    fn idle_minutes_bounds() {
        assert!(validate_idle_minutes(0).is_ok());
        assert!(validate_idle_minutes(1440).is_ok());
        assert!(validate_idle_minutes(1441).is_err());
    }

    #[test]
    fn delays_grow_after_free_attempts_and_are_capped() {
        assert_eq!(delay_after(0), 0);
        assert_eq!(delay_after(2), 0);
        assert_eq!(delay_after(3), 5_000);
        assert_eq!(delay_after(4), 10_000);
        assert_eq!(delay_after(5), 20_000);
        assert_eq!(delay_after(9), MAX_DELAY_MS);
        assert_eq!(delay_after(u32::MAX), MAX_DELAY_MS);
    }

    #[test]
    fn limiter_blocks_then_releases_with_injected_clock() {
        let mut l = AttemptLimiter::default();
        let t0 = 1_000_000;
        for i in 0..2 {
            l.record_failure(t0 + i);
            assert!(l.check(t0 + i).is_ok(), "essai {} libre", i + 1);
        }
        l.record_failure(t0 + 10);
        assert_eq!(l.retry_after_ms(t0 + 10), 5_000);
        assert!(l.check(t0 + 10).unwrap_err().contains("5 s"));
        assert!(l.check(t0 + 5_009).is_err());
        assert!(l.check(t0 + 5_010).is_ok());
        l.record_failure(t0 + 6_000);
        assert_eq!(l.retry_after_ms(t0 + 6_000), 10_000);
        // Un succès remet tout à zéro
        l.record_success();
        assert_eq!(l.failures(), 0);
        assert!(l.check(t0 + 6_001).is_ok());
    }

    #[test]
    fn idle_timer_state_machine() {
        let mut t = IdleTimer::new(0);
        assert!(!t.expired(5, 4 * 60_000 + 59_999));
        assert!(t.expired(5, 5 * 60_000));
        // L'activité repousse l'échéance
        t.touch(4 * 60_000);
        assert!(!t.expired(5, 5 * 60_000));
        assert!(t.expired(5, 9 * 60_000));
        // 0 = jamais, même après des jours
        assert!(!t.expired(0, 10 * 24 * 3_600_000));
        // Horloge qui recule : pas de verrouillage intempestif
        assert!(!t.expired(1, 0));
    }
}
