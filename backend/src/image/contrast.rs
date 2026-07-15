use ndarray::Array2;

/// Apply autocontrast to an image array using percentile clipping and gamma correction.
///
/// Ported from the Python numpy version:
/// - lower_percentile / upper_percentile: for robust min/max (e.g. 0.1 / 99.9)
/// - gamma: gamma correction (e.g. 0.75 for cryo-ET)
/// - bg_subtract: subtract median background from corners
pub fn autocontrast_minmax(
    img: &Array2<f32>,
    lower_percentile: f32,
    upper_percentile: f32,
    gamma: f32,
    bg_subtract: bool,
) -> Array2<u8> {
    let mut data = img.mapv(|v| v);

    // Robust percentile clipping
    let min_val = percentile(&data, lower_percentile);
    let max_val = percentile(&data, upper_percentile);

    // Handle uniform data
    if (max_val - min_val).abs() < f32::EPSILON {
        return Array2::zeros(data.raw_dim());
    }

    // Optional background subtraction
    if bg_subtract {
        let (h, w) = data.dim();
        let corners = vec![
            data.slice(ndarray::s![..10, ..10]).to_owned(),
            data.slice(ndarray::s![h.saturating_sub(10).., ..10]).to_owned(),
            data.slice(ndarray::s![..10, w.saturating_sub(10)..]).to_owned(),
            data.slice(ndarray::s![h.saturating_sub(10).., w.saturating_sub(10)..]).to_owned(),
        ];

        let mut all_corners = Vec::new();
        for c in &corners {
            all_corners.extend(c.iter());
        }
        all_corners.sort_by(|a: &f32, b| a.partial_cmp(b).unwrap());
        let bg_value = if all_corners.is_empty() {
            0.0
        } else {
            let mid = all_corners.len() / 2;
            all_corners[mid]
        };

        data.mapv_inplace(|v| v - bg_value);
    }

    // Normalize to [0, 1]
    let range = max_val - min_val;
    if range < f32::EPSILON {
        return Array2::zeros(data.raw_dim());
    }
    data.mapv_inplace(|v| ((v - min_val) / range).clamp(0.0, 1.0));

    // Apply gamma correction
    if (gamma - 1.0).abs() > f32::EPSILON {
        data.mapv_inplace(|v| v.powf(gamma));
    }

    // Scale to u8
    data.mapv(|v| (v * 255.0).round() as u8)
}

/// Compute a percentile value from an array.
/// O(n) on average using `select_nth_unstable` instead of a full sort.
fn percentile(arr: &Array2<f32>, p: f32) -> f32 {
    let mut values: Vec<f32> = arr.iter().copied().collect();
    if values.is_empty() {
        return 0.0;
    }
    let idx = ((p / 100.0) * (values.len() - 1) as f32).round() as usize;
    let idx = idx.clamp(0, values.len() - 1);
    let (_, &mut percentile, _) = values.select_nth_unstable_by(idx, |a, b| {
        a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
    });
    percentile
}
