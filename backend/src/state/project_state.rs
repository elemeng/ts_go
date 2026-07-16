use std::collections::HashMap;
use std::sync::LazyLock;
use tokio::sync::RwLock;

use crate::models::types::{ScanConfig, TiltSeries};

/// Simple in-memory project state.
pub struct ProjectState {
    pub config: RwLock<Option<ScanConfig>>,
    pub tilt_series: RwLock<HashMap<String, TiltSeries>>,
}

impl ProjectState {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(None),
            tilt_series: RwLock::new(HashMap::new()),
        }
    }

    pub async fn set_config(&self, config: ScanConfig) {
        let mut cfg = self.config.write().await;
        *cfg = Some(config);
        self.tilt_series.write().await.clear();
    }

    pub async fn add_tilt_series(&self, ts: TiltSeries) {
        self.tilt_series.write().await.insert(ts.id.clone(), ts);
    }

    pub async fn get_tilt_series(&self, ts_id: &str) -> Option<TiltSeries> {
        self.tilt_series.read().await.get(ts_id).cloned()
    }

    pub async fn list_tilt_series(&self) -> Vec<TiltSeries> {
        self.tilt_series.read().await.values().cloned().collect()
    }

    pub async fn remove_tilt_series_by_mdoc_path(&self, mdoc_path: &str) {
        let mut ts_map = self.tilt_series.write().await;
        ts_map.retain(|_, ts| ts.mdoc_path != mdoc_path);
    }

    pub async fn update_tilt_series_frames(
        &self,
        mdoc_path: &str,
        selections: &std::collections::HashMap<i32, bool>,
    ) -> Result<(), String> {
        let mut ts_map = self.tilt_series.write().await;
        let ts = ts_map.values().find(|ts| ts.mdoc_path == mdoc_path).cloned();

        if let Some(mut ts) = ts {
            let mut updated_frames = Vec::new();
            let mut min_angle = f64::MAX;
            let mut max_angle = f64::MIN;

            for frame in &ts.frames {
                if selections.get(&frame.z_index).copied().unwrap_or(true) {
                    if frame.angle < min_angle {
                        min_angle = frame.angle;
                    }
                    if frame.angle > max_angle {
                        max_angle = frame.angle;
                    }
                    updated_frames.push(frame.clone());
                }
            }

            if !updated_frames.is_empty() {
                ts.frames = updated_frames;
                ts.angle_range = if min_angle.is_finite() && max_angle.is_finite() {
                    (min_angle, max_angle)
                } else {
                    (0.0, 0.0)
                };
                ts_map.insert(ts.id.clone(), ts);
            } else {
                ts.frames = Vec::new();
                ts_map.insert(ts.id.clone(), ts);
            }
            Ok(())
        } else {
            Err(format!("tilt series not found for mdoc path: {mdoc_path}"))
        }
    }
}

/// Global project state instance
pub static PROJECT_STATE: LazyLock<ProjectState> = LazyLock::new(ProjectState::new);
