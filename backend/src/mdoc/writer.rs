use std::collections::HashMap;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Create a timestamped backup of an mdoc file without ever overwriting an
/// existing `.mdoc.bak`.  This preserves the original file forever and creates
/// a point-in-time recovery copy on every destructive operation.
pub fn create_timestamped_backup(mdoc_path: &Path) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = mdoc_path.with_extension(format!("mdoc.{timestamp}.bak"));
    std::fs::copy(mdoc_path, &backup)
        .map_err(|e| format!("failed to create timestamped backup: {e}"))?;
    Ok(backup)
}

/// Write mdoc file with frame selections using the `emdoc` crate.
///
/// Frames that are not selected are removed from the file.
/// ZValues are preserved as immutable identifiers.
///
/// Returns the backup path if a backup was created.
///
/// Backup strategy (data preservation first):
/// 1. First save ever → creates `.mdoc.bak` (permanent original snapshot)
/// 2. Every save → creates `.mdoc.{unix_seconds}.bak` (point-in-time recovery)
pub fn write_mdoc_with_selections(
    mdoc_path: &str,
    selections: &HashMap<i32, bool>,
) -> Result<String, String> {
    let path = Path::new(mdoc_path);
    if !path.exists() {
        return Err(format!("mdoc file not found: {mdoc_path}"));
    }

    // 1. Preserve the original file as .mdoc.bak (first save only)
    let original_backup = path.with_extension("mdoc.bak");
    if !original_backup.exists() {
        std::fs::copy(path, &original_backup)
            .map_err(|e| format!("failed to create original backup: {e}"))?;
    }

    // 2. Always create a timestamped backup for point-in-time recovery
    let ts_backup = create_timestamped_backup(path)?;

    // Parse the mdoc file
    let file = std::fs::File::open(mdoc_path)
        .map_err(|e| format!("failed to open mdoc: {e}"))?;
    let mut mdoc = emdoc::Mdoc::from_reader(BufReader::new(file))
        .map_err(|e| format!("failed to parse mdoc: {e}"))?;

    // Collect blocks to remove (those not selected)
    let to_remove: Vec<usize> = mdoc
        .blocks()
        .iter()
        .filter(|block| {
            let z = block.z();
            // If selections doesn't have this zIndex, keep it (default true)
            // Only remove if explicitly set to false
            !selections.get(&(z as i32)).copied().unwrap_or(true)
        })
        .map(|block| block.z())
        .collect();

    // Remove deselected blocks
    for z in &to_remove {
        let _ = mdoc.remove(*z);
    }

    // Write back to temp file for atomic operation
    let temp_path = path.with_extension("mdoc.tmp");
    let temp_file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("failed to create temp file: {e}"))?;
    mdoc.write(temp_file)
        .map_err(|e| format!("failed to write mdoc: {e}"))?;

    // Atomic rename
    std::fs::rename(&temp_path, path)
        .map_err(|e| format!("failed to rename temp file: {e}"))?;

    Ok(ts_backup.to_string_lossy().to_string())
}
