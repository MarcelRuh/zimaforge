//! Mod-Verwaltung: Manifeste lesen, Katalog, Installation, Aktivierung, Konfiguration.
//!
//! Layout im Datenverzeichnis:
//! ```text
//! <data>/mods/<id>/forge.json   installierte Mods (auch zimamod.json oder nur mod.js/mod.css)
//! <data>/config/<id>.json       Einstellungen je Mod
//! <data>/state.json             deaktivierte Mods
//! ```

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const MANIFEST: &str = "forge.json";
pub const ZIMAMOD_MANIFEST: &str = "zimamod.json";
pub const MAX_CONFIG_BYTES: usize = 64 * 1024;
/// Einstellungen von ZimaForge selbst (Launcher, Update-Prüfung) – kein Mod.
pub const CORE_CONFIG_ID: &str = "zimaforge";

#[derive(Debug, thiserror::Error)]
pub enum ModError {
    #[error("ungültige Mod-ID")]
    InvalidId,
    #[error("Mod nicht gefunden")]
    NotFound,
    #[error("ungültige Konfiguration: {0}")]
    InvalidConfig(String),
    #[error("ungültiges Manifest: {0}")]
    InvalidManifest(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// Mod-IDs: Kleinbuchstaben, Ziffern, Bindestrich; 1–64 Zeichen; beginnt alphanumerisch.
pub fn valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_alphanumeric()
        && !bytes[0].is_ascii_uppercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// Relative Asset-Pfade innerhalb eines Mod-Ordners, ohne Ausbruch.
pub fn valid_asset_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 256
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|seg| !seg.is_empty() && seg != "." && seg != ".." && !seg.starts_with('.'))
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/'))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Author {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Origin {
    /// `native`, `adapted` oder `compatible`.
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Gemeinsames Manifest für `forge.json` und `zimamod.json`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub authors: Vec<Author>,
    #[serde(default)]
    pub origin: Option<Origin>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub scripts: Vec<String>,
    #[serde(default)]
    pub styles: Vec<String>,
    /// Skripte als ES-Module laden.
    #[serde(default)]
    pub module: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    /// `forge.json`
    Zimaforge,
    /// `zimamod.json` (ZimaMOD/CasaMOD-kompatibel)
    Zimamod,
    /// Nur `mod.js`/`mod.css`
    Bare,
}

/// Aufbereitete Mod-Beschreibung für API und Oberfläche.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub category: String,
    pub authors: Vec<Author>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    pub tags: Vec<String>,
    pub scripts: Vec<String>,
    pub styles: Vec<String>,
    pub module: bool,
    pub format: Format,
    /// Änderungsstempel (neueste Änderungszeit der Mod-Dateien, Sekunden) – für den Browser-Cache.
    pub rev: u64,
    /// Im Manifest vorgesehen (`enabled`), unabhängig vom Benutzerschalter.
    #[serde(skip)]
    pub manifest_enabled: bool,
}

/// Liest einen Mod-Ordner. `None`, wenn der Ordner kein Mod ist.
pub fn read_mod(dir: &Path) -> Result<Option<ModInfo>, ModError> {
    let Some(id) = dir.file_name().and_then(|n| n.to_str()).filter(|id| valid_id(id)) else {
        return Ok(None);
    };
    let (manifest, format) = if dir.join(MANIFEST).is_file() {
        (parse_manifest(&dir.join(MANIFEST))?, Format::Zimaforge)
    } else if dir.join(ZIMAMOD_MANIFEST).is_file() {
        (parse_manifest(&dir.join(ZIMAMOD_MANIFEST))?, Format::Zimamod)
    } else if dir.join("mod.js").is_file() || dir.join("mod.css").is_file() {
        (
            Manifest {
                enabled: true,
                ..Manifest::default()
            },
            Format::Bare,
        )
    } else {
        return Ok(None);
    };

    let mut scripts = manifest.scripts.clone();
    let mut styles = manifest.styles.clone();
    if format == Format::Bare {
        if dir.join("mod.js").is_file() {
            scripts.push("mod.js".into());
        }
        if dir.join("mod.css").is_file() {
            styles.push("mod.css".into());
        }
    }
    for asset in scripts.iter().chain(&styles) {
        if !valid_asset_path(asset) {
            return Err(ModError::InvalidManifest(format!("{id}: ungültiger Pfad {asset:?}")));
        }
    }
    let icon = manifest
        .icon
        .clone()
        .filter(|i| valid_asset_path(i) && dir.join(i).is_file());

    let mut authors = manifest.authors.clone();
    if authors.is_empty()
        && let Some(name) = manifest.author.clone().filter(|a| !a.trim().is_empty())
    {
        authors.push(Author { name, url: None });
    }

    Ok(Some(ModInfo {
        id: id.to_owned(),
        name: manifest.name.clone().unwrap_or_else(|| id.to_owned()),
        version: manifest.version.clone().unwrap_or_else(|| "0.0.0".into()),
        description: manifest.description.clone().unwrap_or_default(),
        category: manifest.category.clone().unwrap_or_else(|| "Allgemein".into()),
        authors,
        origin: manifest.origin.clone(),
        icon,
        homepage: manifest.homepage.clone(),
        tags: manifest.tags.clone(),
        scripts,
        styles,
        module: manifest.module,
        format,
        rev: newest_mtime(dir),
        manifest_enabled: manifest.enabled,
    }))
}

/// Neueste Änderungszeit aller Dateien eines Mod-Ordners (rekursiv, in Sekunden).
fn newest_mtime(dir: &Path) -> u64 {
    let mut newest = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).into_iter().flatten().flatten() {
            let Ok(meta) = e.metadata() else { continue };
            if meta.is_dir() {
                stack.push(e.path());
            } else if let Ok(t) = meta.modified() {
                let secs = t.duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
                newest = newest.max(secs);
            }
        }
    }
    newest
}

fn parse_manifest(path: &Path) -> Result<Manifest, ModError> {
    let raw = fs::read(path)?;
    // UTF-8-BOM tolerieren (häufig bei unter Windows bearbeiteten Dateien).
    let raw = raw.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&raw);
    serde_json::from_slice(raw).map_err(|e| ModError::InvalidManifest(format!("{}: {e}", path.display())))
}

/// Liest alle Mods eines Verzeichnisses; defekte Mods werden protokolliert und übersprungen.
pub fn scan(dir: &Path) -> Vec<ModInfo> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut mods: Vec<ModInfo> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| match read_mod(&e.path()) {
            Ok(m) => m,
            Err(err) => {
                tracing::warn!(path = %e.path().display(), error = %err, "Mod übersprungen");
                None
            }
        })
        .collect();
    mods.sort_by_key(|m| m.name.to_lowercase());
    mods
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    disabled: BTreeSet<String>,
}

/// Eintrag im Store: Katalog und Installationsstand zusammengeführt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreEntry {
    #[serde(flatten)]
    pub info: ModInfo,
    pub in_catalog: bool,
    pub installed: bool,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_version: Option<String>,
    pub update_available: bool,
}

/// Dateibasierte Mod-Verwaltung. Alle Methoden blockieren (in `spawn_blocking` aufrufen).
#[derive(Debug, Clone)]
pub struct ModStore {
    pub catalog_dir: PathBuf,
    pub data_dir: PathBuf,
}

impl ModStore {
    pub fn new(catalog_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self { catalog_dir, data_dir }
    }

    pub fn mods_dir(&self) -> PathBuf {
        self.data_dir.join("mods")
    }

    fn config_dir(&self) -> PathBuf {
        self.data_dir.join("config")
    }

    fn state_path(&self) -> PathBuf {
        self.data_dir.join("state.json")
    }

    pub fn ensure_layout(&self) -> io::Result<()> {
        fs::create_dir_all(self.mods_dir())?;
        fs::create_dir_all(self.config_dir())
    }

    fn load_state(&self) -> State {
        let Ok(raw) = fs::read(self.state_path()) else {
            return State::default();
        };
        serde_json::from_slice(&raw).unwrap_or_else(|err| {
            tracing::warn!(error = %err, "state.json unlesbar – alle installierten Mods gelten als aktiv");
            State::default()
        })
    }

    fn save_state(&self, state: &State) -> io::Result<()> {
        write_atomic(
            &self.state_path(),
            &serde_json::to_vec_pretty(state).expect("serialisierbar"),
        )
    }

    fn is_enabled(&self, state: &State, info: &ModInfo) -> bool {
        info.manifest_enabled && !state.disabled.contains(&info.id)
    }

    /// Aktive, installierte Mods – das, was der Loader lädt.
    pub fn active(&self) -> Vec<ModInfo> {
        let state = self.load_state();
        scan(&self.mods_dir())
            .into_iter()
            .filter(|m| self.is_enabled(&state, m))
            .collect()
    }

    /// Katalog und installierte Mods zusammengeführt.
    pub fn store(&self) -> Vec<StoreEntry> {
        let state = self.load_state();
        let catalog = scan(&self.catalog_dir);
        let installed = scan(&self.mods_dir());

        let mut entries: Vec<StoreEntry> = catalog
            .iter()
            .map(|c| {
                let inst = installed.iter().find(|i| i.id == c.id);
                StoreEntry {
                    info: inst.cloned().unwrap_or_else(|| c.clone()),
                    in_catalog: true,
                    installed: inst.is_some(),
                    enabled: inst.is_some_and(|i| self.is_enabled(&state, i)),
                    installed_version: inst.map(|i| i.version.clone()),
                    catalog_version: Some(c.version.clone()),
                    update_available: inst.is_some_and(|i| i.version != c.version),
                }
            })
            .collect();
        // Lokal installierte Mods ohne Katalogeintrag.
        for inst in installed.iter().filter(|i| !catalog.iter().any(|c| c.id == i.id)) {
            entries.push(StoreEntry {
                info: inst.clone(),
                in_catalog: false,
                installed: true,
                enabled: self.is_enabled(&state, inst),
                installed_version: Some(inst.version.clone()),
                catalog_version: None,
                update_available: false,
            });
        }
        entries.sort_by_key(|e| e.info.name.to_lowercase());
        entries
    }

    /// Installiert (oder aktualisiert) einen Mod aus dem Katalog – atomar per Umbenennen.
    pub fn install(&self, id: &str) -> Result<ModInfo, ModError> {
        if !valid_id(id) {
            return Err(ModError::InvalidId);
        }
        let source = self.catalog_dir.join(id);
        let info = read_mod(&source)?.ok_or(ModError::NotFound)?;
        self.ensure_layout()?;

        let target = self.mods_dir().join(id);
        let staging = self.mods_dir().join(format!(".staging-{id}"));
        let backup = self.mods_dir().join(format!(".old-{id}"));
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&backup);
        copy_dir(&source, &staging)?;
        if target.exists() {
            fs::rename(&target, &backup)?;
        }
        if let Err(err) = fs::rename(&staging, &target) {
            if backup.exists() {
                let _ = fs::rename(&backup, &target);
            }
            let _ = fs::remove_dir_all(&staging);
            return Err(err.into());
        }
        let _ = fs::remove_dir_all(&backup);
        Ok(info)
    }

    pub fn uninstall(&self, id: &str) -> Result<(), ModError> {
        if !valid_id(id) {
            return Err(ModError::InvalidId);
        }
        let target = self.mods_dir().join(id);
        if !target.is_dir() {
            return Err(ModError::NotFound);
        }
        fs::remove_dir_all(target)?;
        let mut state = self.load_state();
        if state.disabled.remove(id) {
            self.save_state(&state)?;
        }
        Ok(())
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<(), ModError> {
        if !valid_id(id) {
            return Err(ModError::InvalidId);
        }
        if read_mod(&self.mods_dir().join(id))?.is_none() {
            return Err(ModError::NotFound);
        }
        let mut state = self.load_state();
        let changed = if enabled {
            state.disabled.remove(id)
        } else {
            state.disabled.insert(id.to_owned())
        };
        if changed {
            self.save_state(&state)?;
        }
        Ok(())
    }

    pub fn read_config(&self, id: &str) -> Result<serde_json::Value, ModError> {
        if !valid_id(id) {
            return Err(ModError::InvalidId);
        }
        match fs::read(self.config_dir().join(format!("{id}.json"))) {
            Ok(raw) => Ok(serde_json::from_slice(&raw).unwrap_or(serde_json::Value::Null)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
            Err(e) => Err(e.into()),
        }
    }

    pub fn write_config(&self, id: &str, raw: &[u8]) -> Result<serde_json::Value, ModError> {
        if !valid_id(id) {
            return Err(ModError::InvalidId);
        }
        if raw.len() > MAX_CONFIG_BYTES {
            return Err(ModError::InvalidConfig("zu groß".into()));
        }
        // Nur für ZimaForge selbst und installierte Mods – sonst ließen sich beliebig
        // viele Konfigurationsdateien anlegen.
        if id != CORE_CONFIG_ID && read_mod(&self.mods_dir().join(id))?.is_none() {
            return Err(ModError::NotFound);
        }
        let value: serde_json::Value =
            serde_json::from_slice(raw).map_err(|e| ModError::InvalidConfig(e.to_string()))?;
        self.ensure_layout()?;
        write_atomic(
            &self.config_dir().join(format!("{id}.json")),
            &serde_json::to_vec_pretty(&value).expect("serialisierbar"),
        )?;
        Ok(value)
    }

    /// Absoluter Pfad einer Mod-Datei, sofern sie existiert und gültig ist.
    pub fn asset_path(&self, id: &str, rel: &str) -> Option<PathBuf> {
        if !valid_id(id) || !valid_asset_path(rel) {
            return None;
        }
        let path = self.mods_dir().join(id).join(rel);
        path.is_file().then_some(path)
    }

    /// Datei eines Katalog-Mods (z. B. Icon für die Store-Vorschau vor der Installation).
    pub fn catalog_asset_path(&self, id: &str, rel: &str) -> Option<PathBuf> {
        if !valid_id(id) || !valid_asset_path(rel) {
            return None;
        }
        let path = self.catalog_dir.join(id).join(rel);
        path.is_file().then_some(path)
    }
}

/// Schreibt über eine temporäre Datei mit `fsync` – nach einem Stromausfall steht
/// entweder der alte oder der neue Inhalt da, nie eine leere Datei.
fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp)?;
    file.write_all(data)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&tmp, path)?;
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        let _ = fs::File::open(dir).and_then(|d| d.sync_all());
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let dest = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), dest)?;
        }
        // Symlinks werden bewusst nicht übernommen.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn setup() -> (tempfile::TempDir, ModStore) {
        let tmp = tempfile::tempdir().unwrap();
        let store = ModStore::new(tmp.path().join("catalog"), tmp.path().join("data"));
        write(
            &store.catalog_dir.join("neon/forge.json"),
            r#"{"name":"Neon","version":"1.0.0","scripts":["mod.js"],"styles":["mod.css"],"authors":[{"name":"Marcel"}]}"#,
        );
        write(&store.catalog_dir.join("neon/mod.js"), "1");
        write(&store.catalog_dir.join("neon/mod.css"), "a{}");
        write(&store.catalog_dir.join("neon/lib/x.js"), "2");
        (tmp, store)
    }

    #[test]
    fn ids_and_paths() {
        assert!(valid_id("ora-theme"));
        assert!(valid_id("a1"));
        assert!(!valid_id("-x"));
        assert!(!valid_id("Upper"));
        assert!(!valid_id("a_b"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"a".repeat(65)));
        assert!(valid_asset_path("mod.js"));
        assert!(valid_asset_path("icons/a.svg"));
        assert!(!valid_asset_path("../x"));
        assert!(!valid_asset_path("/etc/passwd"));
        assert!(!valid_asset_path("a//b"));
        assert!(!valid_asset_path(".hidden"));
        assert!(!valid_asset_path("a\\b"));
    }

    #[test]
    fn zimamod_and_bare_formats() {
        let tmp = tempfile::tempdir().unwrap();
        write(
            &tmp.path().join("old/zimamod.json"),
            "\u{feff}{\"name\":\"Old\",\"scripts\":[\"mod.js\"],\"enabled\":false,\"origin\":{\"type\":\"compatible\"}}",
        );
        write(&tmp.path().join("bare/mod.css"), "");
        write(&tmp.path().join("empty/readme.txt"), "");
        let mods = scan(tmp.path());
        assert_eq!(mods.len(), 2);
        let bare = mods.iter().find(|m| m.id == "bare").unwrap();
        assert_eq!(bare.format, Format::Bare);
        assert_eq!(bare.styles, vec!["mod.css"]);
        let old = mods.iter().find(|m| m.id == "old").unwrap();
        assert_eq!(old.format, Format::Zimamod);
        assert!(!old.manifest_enabled);
    }

    #[test]
    fn rejects_escaping_manifest_paths() {
        let tmp = tempfile::tempdir().unwrap();
        write(&tmp.path().join("evil/forge.json"), r#"{"scripts":["../../x.js"]}"#);
        assert!(read_mod(&tmp.path().join("evil")).is_err());
        assert!(scan(tmp.path()).is_empty());
    }

    #[test]
    fn install_update_disable_uninstall() {
        let (_tmp, store) = setup();
        let entries = store.store();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].installed);

        store.install("neon").unwrap();
        assert!(store.mods_dir().join("neon/lib/x.js").is_file());
        assert_eq!(store.active().len(), 1);

        // Neue Katalogversion -> Update verfügbar, Reinstall übernimmt sie.
        write(
            &store.catalog_dir.join("neon/forge.json"),
            r#"{"name":"Neon","version":"1.1.0","scripts":["mod.js"]}"#,
        );
        let e = &store.store()[0];
        assert!(e.update_available);
        assert_eq!(e.installed_version.as_deref(), Some("1.0.0"));
        store.install("neon").unwrap();
        assert!(!store.store()[0].update_available);

        store.set_enabled("neon", false).unwrap();
        assert!(store.active().is_empty());
        assert!(!store.store()[0].enabled);
        store.set_enabled("neon", true).unwrap();
        assert_eq!(store.active().len(), 1);

        store.uninstall("neon").unwrap();
        assert!(store.active().is_empty());
        assert!(matches!(store.uninstall("neon"), Err(ModError::NotFound)));
        assert!(matches!(store.install("nope"), Err(ModError::NotFound)));
        assert!(matches!(store.install("../x"), Err(ModError::InvalidId)));
    }

    #[test]
    fn local_mods_show_up_in_store() {
        let (_tmp, store) = setup();
        write(&store.mods_dir().join("mine/mod.js"), "");
        let entries = store.store();
        let mine = entries.iter().find(|e| e.info.id == "mine").unwrap();
        assert!(mine.installed && !mine.in_catalog && mine.enabled);
    }

    #[test]
    fn config_roundtrip_and_limits() {
        let (_tmp, store) = setup();
        assert!(
            matches!(store.write_config("neon", b"{}"), Err(ModError::NotFound)),
            "nur installierte Mods"
        );
        store.write_config(CORE_CONFIG_ID, br#"{"launcher":"hidden"}"#).unwrap();
        store.install("neon").unwrap();
        assert_eq!(store.read_config("neon").unwrap(), serde_json::Value::Null);
        store.write_config("neon", br#"{"a":1}"#).unwrap();
        assert_eq!(store.read_config("neon").unwrap()["a"], 1);
        assert!(matches!(
            store.write_config("neon", b"{nope"),
            Err(ModError::InvalidConfig(_))
        ));
        let big = format!("\"{}\"", "x".repeat(MAX_CONFIG_BYTES));
        assert!(matches!(
            store.write_config("neon", big.as_bytes()),
            Err(ModError::InvalidConfig(_))
        ));
    }

    #[test]
    fn asset_path_guards() {
        let (_tmp, store) = setup();
        store.install("neon").unwrap();
        assert!(store.asset_path("neon", "lib/x.js").is_some());
        assert!(store.asset_path("neon", "../neon/mod.js").is_none());
        assert!(store.asset_path("neon", "missing.js").is_none());
    }
}
