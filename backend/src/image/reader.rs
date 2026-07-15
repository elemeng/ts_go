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
    let block = reader.convert::<f32>().read_volume().ok()?;
    let slice_len = nx * ny;
    let flat: Vec<f32> = block.data.into_iter().take(slice_len).collect();
    if flat.len() != slice_len {
        return None;
    }
    Array2::from_shape_vec((ny, nx), flat).ok()
}

fn read_tiff(path: &str) -> Option<Array2<f32>> {
    let img = image::ImageReader::open(path).ok()?.decode().ok()?;
    let gray = img.to_luma32f();
    let (width, height) = gray.dimensions();
    let data: Vec<f32> = gray.into_raw();
    Array2::from_shape_vec((height as usize, width as usize), data).ok()
}
