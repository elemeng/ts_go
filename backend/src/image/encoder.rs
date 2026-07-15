use image::GrayImage;
use ndarray::Array2;
use std::io::Cursor;
use std::path::Path;

fn array_to_gray_image(img: &Array2<u8>) -> Result<GrayImage, String> {
    let (h, w) = img.dim();
    // Ensure row-major order then copy the underlying buffer.
    let data: Vec<u8> = img.as_standard_layout().iter().copied().collect();
    GrayImage::from_raw(w as u32, h as u32, data)
        .ok_or_else(|| format!("failed to create GrayImage from {}x{} array", w, h))
}

/// Encode a u8 grayscale array as PNG bytes.
pub fn encode_png(img: &Array2<u8>, _quality: u8) -> Result<Vec<u8>, String> {
    let gray_img = array_to_gray_image(img)?;
    let mut buffer = Vec::new();
    let mut cursor = Cursor::new(&mut buffer);
    gray_img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("failed to encode PNG: {e}"))?;
    Ok(buffer)
}

/// Save a u8 grayscale array as a PNG file.
pub fn save_png(img: &Array2<u8>, path: &str) -> Result<(), String> {
    let gray_img = array_to_gray_image(img)?;
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create directory for PNG: {e}"))?;
    }
    gray_img.save(p).map_err(|e| format!("failed to save PNG: {e}"))?;
    Ok(())
}
