use std::path::Path;

use crate::matcher::cut_match::ImageMatcher;
use crate::models::types::{Frame, TiltSeries};

/// Parse an mdoc file using the `emdoc` crate and return a TiltSeries.
pub fn parse_mdoc_file(mdoc_path: &str, matcher: &ImageMatcher) -> Result<TiltSeries, String> {
    let path = Path::new(mdoc_path);
    if !path.exists() {
        return Err(format!("mdoc file not found: {mdoc_path}"));
    }

    let file = std::fs::File::open(mdoc_path)
        .map_err(|e| format!("Failed to open mdoc file: {e}"))?;
    let reader = std::io::BufReader::new(file);

    let mdoc = emdoc::Mdoc::from_reader(reader)
        .map_err(|e| format!("Failed to parse mdoc file: {e}"))?;

    let mut frames: Vec<Frame> = Vec::new();
    let mut angles: Vec<f64> = Vec::new();

    for block in mdoc.blocks() {
        let z_value = block.z() as i32;

        // Parse TiltAngle
        let angle = block
            .get("TiltAngle")
            .and_then(|v| v.trim_end_matches(';').trim().parse::<f64>().ok())
            .unwrap_or(0.0);

        angles.push(angle);

        // Parse SubFramePath and match to image file
        let mrc_path = block
            .get("SubFramePath")
            .map(|subframe_path| {
                // Normalize path separators
                let normalized = subframe_path.replace('\\', "/");
                let filename = Path::new(&normalized)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                // Try to match via image matcher
                let filename_no_ext = Path::new(&filename)
                    .file_stem()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                matcher
                    .match_filename(&filename_no_ext)
                    .or_else(|| matcher.match_filename(&filename))
                    .unwrap_or(filename)
            })
            .unwrap_or_default();

        frames.push(Frame {
            z_index: z_value,
            angle,
            mrc_path,
            selected: true,
        });
    }

    if frames.is_empty() {
        return Err(format!("No frames found in mdoc: {mdoc_path}"));
    }

    let angle_range = if angles.is_empty() {
        (0.0, 0.0)
    } else {
        let min = angles.iter().cloned().fold(f64::MAX, f64::min);
        let max = angles.iter().cloned().fold(f64::MIN, f64::max);
        (min, max)
    };

    let id = path
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(TiltSeries {
        id,
        mdoc_path: path.to_string_lossy().to_string(),
        frames,
        angle_range,
    })
}
