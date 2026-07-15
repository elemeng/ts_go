use ndarray::Array2;

/// Bin downsample array by averaging blocks.
/// `factor` must be a positive integer.
/// Returns a new array with dimensions reduced by factor.
pub fn bin_ndarray(arr: &Array2<f32>, factor: usize) -> Array2<f32> {
    if factor <= 1 {
        return arr.clone();
    }

    let (h, w) = arr.dim();
    let h_trim = h - (h % factor);
    let w_trim = w - (w % factor);
    let arr = arr.slice(ndarray::s![..h_trim, ..w_trim]);

    let h_new = h_trim / factor;
    let w_new = w_trim / factor;

    let mut binned = Array2::<f32>::zeros((h_new, w_new));
    for (chunk, cell) in arr.exact_chunks((factor, factor))
        .into_iter()
        .zip(binned.iter_mut())
    {
        *cell = chunk.mean().unwrap_or(0.0);
    }

    binned
}
