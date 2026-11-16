//! Der mitgelieferte Katalog (`mods/`) muss vollständig gültig sein.

use std::path::Path;

use zimaforge::mods::{Format, read_mod, scan};

#[test]
fn bundled_mods_are_valid() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("mods");
    let entries: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .collect();
    assert!(!entries.is_empty());

    for entry in &entries {
        let path = entry.path();
        let info = read_mod(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .unwrap_or_else(|| panic!("{} ist kein Mod", path.display()));
        assert_eq!(info.format, Format::Zimaforge, "{}: forge.json fehlt", info.id);
        assert!(!info.description.is_empty(), "{}: Beschreibung fehlt", info.id);
        assert!(info.version.split('.').count() == 3, "{}: SemVer erwartet", info.id);
        assert!(info.icon.is_some(), "{}: Icon fehlt", info.id);
        assert!(!info.authors.is_empty(), "{}: Autor fehlt", info.id);
        for asset in info.scripts.iter().chain(&info.styles) {
            assert!(path.join(asset).is_file(), "{}: {asset} fehlt", info.id);
        }
    }
    assert_eq!(scan(&dir).len(), entries.len());
}
