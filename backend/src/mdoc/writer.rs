use std::collections::HashMap;
use std::io::BufReader;
use std::path::Path;

/// Write mdoc file with frame selections using the `emdoc` crate.
///
/// Frames that are not selected are removed from the file.
/// ZValues are preserved as immutable identifiers.
///
/// Returns the backup path if a backup was created.
pub fn write_mdoc_with_selections(
    mdoc_path: &str,
    selections: &HashMap<i32, bool>,
) -> Result<String, String> {
    let path = Path::new(mdoc_path);
    if !path.exists() {
        return Err(format!("mdoc file not found: {mdoc_path}"));
    }

    // Create backup
    let backup = path.with_extension("mdoc.bak");
    if !backup.exists() {
        std::fs::copy(path, &backup)
            .map_err(|e| format!("Failed to create backup: {e}"))?;
    }

    // Parse the mdoc file
    let file = std::fs::File::open(mdoc_path)
        .map_err(|e| format!("Failed to open mdoc: {e}"))?;
    let mut mdoc = emdoc::Mdoc::from_reader(BufReader::new(file))
        .map_err(|e| format!("Failed to parse mdoc: {e}"))?;

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
        .map_err(|e| format!("Failed to create temp file: {e}"))?;
    mdoc.write(temp_file)
        .map_err(|e| format!("Failed to write mdoc: {e}"))?;

    // Atomic rename
    std::fs::rename(&temp_path, path)
        .map_err(|e| format!("Failed to rename temp file: {e}"))?;

    Ok(backup.to_string_lossy().to_string())
}
