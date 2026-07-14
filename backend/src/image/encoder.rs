use image::{GrayImage, Luma};
use ndarray::Array2;
use std::io::Cursor;

/// Encode a u8 grayscale array as PNG bytes.
pub fn encode_png(img: &Array2<u8>, _quality: u8) -> Vec<u8> {
    let (h, w) = img.dim();
    let mut gray_img = GrayImage::new(w as u32, h as u32);
    for (y, row) in img.rows().into_iter().enumerate() {
        for (x, &val) in row.iter().enumerate() {
            gray_img.put_pixel(x as u32, y as u32, Luma([val]));
        }
    }

    let mut buffer = Vec::new();
    let mut cursor = Cursor::new(&mut buffer);
    gray_img
        .write_to(&mut cursor, image::ImageFormat::Png)
        .expect("PNG encoding should succeed");
    buffer
}

/// Save a u8 grayscale array as a PNG file.
pub fn save_png(img: &Array2<u8>, path: &str) {
    let (h, w) = img.dim();
    let mut gray_img = GrayImage::new(w as u32, h as u32);
    for (y, row) in img.rows().into_iter().enumerate() {
        for (x, &val) in row.iter().enumerate() {
            gray_img.put_pixel(x as u32, y as u32, Luma([val]));
        }
    }

    if let Some(parent) = std::path::Path::new(path).parent() {
        std::fs::create_dir_all(parent).ok();
    }
    gray_img.save(path).expect("PNG save should succeed");
}
