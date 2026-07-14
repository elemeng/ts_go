use serde::{Deserialize, Serialize};

/// Represents a single frame in a tilt series.
///
/// IMPORTANT: zIndex is an immutable identifier that must never change.
/// - zIndex: Unique identifier for this frame (from mdoc ZValue)
/// - angle: Tilt angle in degrees
/// - mrc_path: Path to the MRC file containing this frame
/// - selected: Current selection state (mutable)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    #[serde(rename = "zIndex")]
    pub z_index: i32,
    pub angle: f64,
    #[serde(rename = "mrcPath")]
    pub mrc_path: String,
    pub selected: bool,
}

/// Represents a complete tilt series from an mdoc file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TiltSeries {
    pub id: String,
    #[serde(rename = "mdocPath")]
    pub mdoc_path: String,
    pub frames: Vec<Frame>,
    #[serde(rename = "angleRange")]
    pub angle_range: (f64, f64),
}

/// Configuration for scanning a project directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    pub mdoc_dir: String,
    pub image_dir: String,
    pub png_dir: String,
    #[serde(default)]
    pub mdoc_prefix_cut: i32,
    #[serde(default)]
    pub mdoc_suffix_cut: i32,
    #[serde(default)]
    pub image_prefix_cut: i32,
    #[serde(default)]
    pub image_suffix_cut: i32,
}

/// Response from project scan operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct MdocScanResponse {
    pub tilt_series: Vec<TiltSeries>,
    pub total: usize,
}

/// Request to save all mdoc changes.
#[derive(Debug, Deserialize)]
pub struct SaveAllRequest {
    /// mdoc_path -> {zIndex: selected}
    pub selections: std::collections::HashMap<String, std::collections::HashMap<i32, bool>>,
}

/// Response from save all operation.
#[derive(Debug, Serialize)]
pub struct SaveAllResponse {
    pub success: bool,
    pub saved: Vec<String>,
    pub failed: Vec<String>,
    pub deleted: Vec<String>,
    pub message: String,
}

/// Request to delete multiple mdoc files.
#[derive(Debug, Deserialize)]
pub struct DeleteAllRequest {
    pub mdoc_paths: Vec<String>,
}

/// Request for batch saving a single mdoc.
#[derive(Debug, Deserialize)]
pub struct BatchSaveRequest {
    pub mdoc_path: String,
    /// zIndex -> selected
    pub selections: std::collections::HashMap<i32, bool>,
}

/// Response from batch save operation.
#[derive(Debug, Serialize)]
pub struct BatchSaveResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_tilt_series: Option<TiltSeries>,
}

/// Response from backup-delete operation.
#[derive(Debug, Serialize)]
pub struct BackupDeleteResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
}

/// Request for saving a config file.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct SaveConfigRequest {
    pub mdoc_dir: String,
    pub image_dir: String,
    pub png_dir: String,
    #[serde(default)]
    pub mdoc_prefix_cut: i32,
    #[serde(default)]
    pub mdoc_suffix_cut: i32,
    #[serde(default)]
    pub image_prefix_cut: i32,
    #[serde(default)]
    pub image_suffix_cut: i32,
}
