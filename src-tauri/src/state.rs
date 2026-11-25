//! What every command can reach: the data folder, one HTTP client, the
//! settings, the requests that can be stopped, and the on-device engine.

use crate::settings::Settings;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

pub struct AppState {
    pub data_dir: PathBuf,
    pub http: reqwest::Client,
    pub settings: RwLock<Settings>,
    /// Stop flags for requests in flight (chat turns, model downloads),
    /// by the id the frontend gave them.
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub local: crate::ai::local::LocalEngine,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> AppState {
        let _ = std::fs::create_dir_all(&data_dir);
        for sub in ["documents", "sources", "models"] {
            let _ = std::fs::create_dir_all(data_dir.join(sub));
        }
        let settings = crate::settings::load(&data_dir);
        let http = reqwest::Client::builder()
            .user_agent("Nudge/0.1")
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("HTTP client");
        AppState {
            local: crate::ai::local::LocalEngine::new(),
            data_dir,
            http,
            settings: RwLock::new(settings),
            cancels: Mutex::new(HashMap::new()),
        }
    }

    pub fn models_dir(&self) -> PathBuf {
        self.data_dir.join("models")
    }

    /// A stop flag for `id`, registered until `finish_cancel` drops it.
    pub fn cancel_flag(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels.lock().unwrap().insert(id.to_string(), flag.clone());
        flag
    }

    pub fn finish_cancel(&self, id: &str) {
        self.cancels.lock().unwrap().remove(id);
    }

    pub fn cancel(&self, id: &str) {
        if let Some(f) = self.cancels.lock().unwrap().get(id) {
            f.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
}
