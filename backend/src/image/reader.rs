use ndarray::Array2;
use std::path::Path;

/// Read an MRC or TIFF image file and return as 2D f32 array.
/// Supports .mrc, .mrcs, .rec, .eer (MRC/CCP4 format) and .tif, .tiff (TIFF) extensions.
pub fn read_image(path: &str) -> Result<Array2<f32>, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .ok_or_else(|| format!("cannot extract extension from path: {path}"))?
        .to_str()
        .ok_or_else(|| format!("non-UTF-8 extension in path: {path}"))?
        .to_lowercase();

    match ext.as_str() {
        "mrc" | "mrcs" | "rec" => read_mrc(path),
        "tif" | "tiff" => read_tiff(path),
        _ => Err(format!("unsupported image format: {ext}")),
    }
}

fn read_mrc(path: &str) -> Result<Array2<f32>, String> {
    let reader =
        mrc::Reader::open(path).map_err(|e| format!("failed to open MRC file {path}: {e}"))?;
    let header = reader.header();
    let nx = header.nx as usize;
    let ny = header.ny as usize;
    let block = reader
        .convert::<f32>()
        .read_volume()
        .map_err(|e| format!("failed to read MRC volume from {path}: {e}"))?;
    let slice_len = nx * ny;
    let flat: Vec<f32> = block.data.into_iter().take(slice_len).collect();
    if flat.len() != slice_len {
        return Err(format!(
            "MRC file {path}: expected {slice_len} pixels but got {}",
            flat.len()
        ));
    }
    Array2::from_shape_vec((ny, nx), flat)
        .map_err(|e| format!("failed to create array from MRC data from {path}: {e}"))
}

fn read_tiff(path: &str) -> Result<Array2<f32>, String> {
    let img = image::ImageReader::open(path)
        .map_err(|e| format!("failed to open TIFF file {path}: {e}"))?
        .decode()
        .map_err(|e| format!("failed to decode TIFF file {path}: {e}"))?;
    let gray = img.to_luma32f();
    let (width, height) = gray.dimensions();
    let data: Vec<f32> = gray.into_raw();
    Array2::from_shape_vec((height as usize, width as usize), data)
        .map_err(|e| format!("failed to create array from TIFF data from {path}: {e}"))
}
