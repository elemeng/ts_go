use ndarray::Array2;

/// Bin downsample array by averaging blocks.
/// `factor` must be a positive integer.
/// Returns a new array with dimensions reduced by factor.
pub fn bin_ndarray(arr: &Array2<f64>, factor: usize) -> Array2<f64> {
    if factor <= 1 {
        return arr.clone();
    }

    let (h, w) = arr.dim();
    let h_trim = h - (h % factor);
    let w_trim = w - (w % factor);
    let arr = arr.slice(ndarray::s![..h_trim, ..w_trim]);

    let h_new = h_trim / factor;
    let w_new = w_trim / factor;

    let mut binned = Array2::<f64>::zeros((h_new, w_new));
    for i in 0..h_new {
        for j in 0..w_new {
            let mut sum = 0.0;
            for di in 0..factor {
                for dj in 0..factor {
                    sum += arr[[i * factor + di, j * factor + dj]];
                }
            }
            binned[[i, j]] = sum / (factor * factor) as f64;
        }
    }

    binned
}
