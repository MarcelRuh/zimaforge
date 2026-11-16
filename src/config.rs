//! Laufzeit-Konfiguration aus Umgebungsvariablen.

use std::net::SocketAddr;
use std::path::PathBuf;

use hyper::Uri;

/// Vollständige Konfiguration von ZimaForge.
#[derive(Debug, Clone)]
pub struct Config {
    /// Adresse, auf der das gemoddete Dashboard ausgeliefert wird.
    pub listen: SocketAddr,
    /// ZimaOS-Gateway, das hinter ZimaForge liegt (z. B. `http://127.0.0.1:80`).
    pub upstream: Uri,
    /// Persistente Daten: installierte Mods, Konfiguration, Status.
    pub data_dir: PathBuf,
    /// Mitgelieferter Katalog (im Image schreibgeschützt).
    pub catalog_dir: PathBuf,
    /// `/proc` des Hosts für Systemwerte.
    pub proc_dir: PathBuf,
    /// `/sys` des Hosts für Temperaturen.
    pub sys_dir: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("ungültiger Wert für {name}: {value}")]
    Invalid { name: &'static str, value: String },
}

impl Config {
    /// Liest die Konfiguration aus `ZIMAFORGE_*`-Variablen mit sinnvollen Vorgaben.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let var = |name: &'static str, default: &str| {
            get(name)
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| default.to_owned())
        };

        let bind = var("ZIMAFORGE_BIND", "0.0.0.0");
        let port = var("ZIMAFORGE_PORT", "8077");
        let port: u16 = port.parse().ok().filter(|p| *p != 0).ok_or(ConfigError::Invalid {
            name: "ZIMAFORGE_PORT",
            value: port.clone(),
        })?;
        let listen: SocketAddr = format!("{bind}:{port}")
            .parse()
            .or_else(|_| format!("[{bind}]:{port}").parse())
            .map_err(|_| ConfigError::Invalid {
                name: "ZIMAFORGE_BIND",
                value: bind.clone(),
            })?;

        let upstream_raw = var("ZIMAFORGE_UPSTREAM", "http://127.0.0.1:80");
        let upstream: Uri = upstream_raw
            .parse()
            .ok()
            .filter(|u: &Uri| u.scheme_str() == Some("http") && u.authority().is_some())
            .ok_or(ConfigError::Invalid {
                name: "ZIMAFORGE_UPSTREAM",
                value: upstream_raw.clone(),
            })?;

        Ok(Self {
            listen,
            upstream,
            data_dir: var("ZIMAFORGE_DATA", "/data").into(),
            catalog_dir: var("ZIMAFORGE_CATALOG", "/opt/zimaforge/catalog").into(),
            proc_dir: var("ZIMAFORGE_PROC", "/host/proc").into(),
            sys_dir: var("ZIMAFORGE_SYS", "/host/sys").into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn cfg(pairs: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| ((*k).into(), (*v).into())).collect();
        Config::from_lookup(|k| map.get(k).cloned())
    }

    #[test]
    fn defaults() {
        let c = cfg(&[]).unwrap();
        assert_eq!(c.listen.to_string(), "0.0.0.0:8077");
        assert_eq!(c.upstream.to_string(), "http://127.0.0.1:80/");
        assert_eq!(c.data_dir, PathBuf::from("/data"));
    }

    #[test]
    fn rejects_bad_port_and_https_upstream() {
        assert!(cfg(&[("ZIMAFORGE_PORT", "0")]).is_err());
        assert!(cfg(&[("ZIMAFORGE_PORT", "abc")]).is_err());
        assert!(cfg(&[("ZIMAFORGE_UPSTREAM", "https://x")]).is_err());
        assert!(cfg(&[("ZIMAFORGE_UPSTREAM", "nonsense")]).is_err());
    }

    #[test]
    fn ipv6_bind() {
        let c = cfg(&[("ZIMAFORGE_BIND", "::"), ("ZIMAFORGE_PORT", "9000")]).unwrap();
        assert_eq!(c.listen.to_string(), "[::]:9000");
    }
}
