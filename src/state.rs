use std::sync::Arc;

use crate::auth::SessionValidator;
use crate::config::Config;
use crate::metrics::MetricsReader;
use crate::mods::ModStore;
use crate::proxy::{self, HttpClient};
use crate::sysinfo::SystemReader;

/// Gemeinsamer Zustand aller Handler.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub client: HttpClient,
    pub auth: SessionValidator,
    pub store: ModStore,
    pub metrics: Arc<MetricsReader>,
    pub system: Arc<SystemReader>,
    /// Serialisiert schreibende Store-Operationen.
    pub write_lock: Arc<tokio::sync::Mutex<()>>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let client = proxy::client();
        Self {
            auth: SessionValidator::new(client.clone(), config.upstream.clone()),
            store: ModStore::new(config.catalog_dir.clone(), config.data_dir.clone()),
            metrics: Arc::new(MetricsReader::new(config.proc_dir.clone(), config.sys_dir.clone())),
            system: Arc::new(SystemReader::new(
                config.proc_dir.clone(),
                config.sys_dir.clone(),
                config.data_dir.clone(),
                config.docker_dir.clone(),
            )),
            write_lock: Arc::default(),
            client,
            config: Arc::new(config),
        }
    }
}
