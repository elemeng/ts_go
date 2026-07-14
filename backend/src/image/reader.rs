use ndarray::Array2;
use std::path::Path;

/// Read an MRC or TIFF image file and return as 2D f32 array.
/// Supports .mrc, .mrcs, .rec, .eer (MRC/CCP4 format) and .tif, .tiff (TIFF) extensions.
pub fn read_image(path: &str) -> Option<Array2<f32>> {
    let p = Path::new(path);
    let ext = p.extension()?.to_str()?.to_lowercase();

    match ext.as_str() {
        "mrc" | "mrcs" | "rec" => read_mrc(path),
        "tif" | "tiff" => read_tiff(path),
        _ => {
            eprintln!("Unsupported image format: {ext}");
            None
        }
    }
}

fn read_mrc(path: &str) -> Option<Array2<f32>> {
    let reader = mrc::Reader::open(path).ok()?;
    let header = reader.header();
    let nx = header.nx as usize;
    let ny = header.ny as usize;
    let mode = header.mode;

    // Try to read as f32 directly (common mode 2)
    if let Ok(block) = reader.read_volume::<f32>() {
        let slice_len = nx * ny;
        let flat: Vec<f32> = block.data.iter().take(slice_len).copied().collect();
        if flat.len() != nx * ny {
            return None;
        }
        return Some(Array2::from_shape_vec((ny, nx), flat).ok()?);
    }

    // Re-open and try the file's native mode
    let reader = mrc::Reader::open(path).ok()?;

    match mode {
        12 => { // Float16
            // Float16 (half precision) — read as f16, convert to f32
            let block = reader.read_volume::<mrc::f16>().ok()?;
            let slice_len = nx * ny;
            let flat: Vec<f32> = block.data.iter()
                .take(slice_len)
                .map(|v| f32::from(*v))
                .collect();
            if flat.len() != nx * ny {
                return None;
            }
            Some(Array2::from_shape_vec((ny, nx), flat).ok()?)
        }
        1 => { // Int16
            let block = reader.read_volume::<i16>().ok()?;
            let slice_len = nx * ny;
            let flat: Vec<f32> = block.data.iter()
                .take(slice_len)
                .map(|&v| v as f32)
                .collect();
            if flat.len() != nx * ny {
                return None;
            }
            Some(Array2::from_shape_vec((ny, nx), flat).ok()?)
        }
        6 => { // Uint16
            let block = reader.read_volume::<u16>().ok()?;
            let slice_len = nx * ny;
            let flat: Vec<f32> = block.data.iter()
                .take(slice_len)
                .map(|&v| v as f32)
                .collect();
            if flat.len() != nx * ny {
                return None;
            }
            Some(Array2::from_shape_vec((ny, nx), flat).ok()?)
        }
        0 => { // Int8
            let block = reader.read_volume::<i8>().ok()?;
            let slice_len = nx * ny;
            let flat: Vec<f32> = block.data.iter()
                .take(slice_len)
                .map(|&v| v as f32)
                .collect();
            if flat.len() != nx * ny {
                return None;
            }
            Some(Array2::from_shape_vec((ny, nx), flat).ok()?)
        }
        other => {
            eprintln!("Unsupported MRC mode: {other}");
            None
        }
    }
}

fn read_tiff(path: &str) -> Option<Array2<f32>> {
    let img = image::ImageReader::open(path).ok()?.decode().ok()?;
    let gray = img.to_luma32f();
    let (width, height) = gray.dimensions();
    let data: Vec<f32> = gray.into_raw();
    Some(Array2::from_shape_vec((height as usize, width as usize), data).ok()?)
}
