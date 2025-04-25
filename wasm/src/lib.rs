// lib.rs
use wasm_bindgen::prelude::*;
use rayon::prelude::*;
use std::mem::size_of;
use std::collections::HashMap;
use once_cell::sync::Lazy;

// === Utility Functions ===

#[inline(always)]
fn clamp(value: f32, min: f32, max: f32) -> f32 {
    value.max(min).min(max)
}

#[inline(always)]
fn rect_sum(integral: &[u32], w: usize, x0: usize, y0: usize, x1: usize, y1: usize) -> u32 {
    unsafe {
        let a = if x0 > 0 && y0 > 0 { *integral.get_unchecked((y0 - 1) * w + (x0 - 1)) } else { 0 };
        let b = if y0 > 0 { *integral.get_unchecked((y0 - 1) * w + x1) } else { 0 };
        let c = if x0 > 0 { *integral.get_unchecked(y1 * w + (x0 - 1)) } else { 0 };
        let d = *integral.get_unchecked(y1 * w + x1);
        d + a - b - c
    }
}

fn compute_integral_images(data: &[u8], w: usize, h: usize) -> (Vec<u32>, Vec<u32>, Vec<u32>) {
    let mut int_r = vec![0u32; w * h];
    let mut int_g = vec![0u32; w * h];
    let mut int_b = vec![0u32; w * h];
    unsafe {
        for y in 0..h {
            let mut row_sum_r = 0u32;
            let mut row_sum_g = 0u32;
            let mut row_sum_b = 0u32;
            for x in 0..w {
                let idx = (y * w + x) * 4;
                row_sum_r += *data.get_unchecked(idx) as u32;
                row_sum_g += *data.get_unchecked(idx + 1) as u32;
                row_sum_b += *data.get_unchecked(idx + 2) as u32;
                let above_r = if y > 0 { int_r[(y - 1) * w + x] } else { 0 };
                let above_g = if y > 0 { int_g[(y - 1) * w + x] } else { 0 };
                let above_b = if y > 0 { int_b[(y - 1) * w + x] } else { 0 };
                *int_r.get_unchecked_mut(y * w + x) = row_sum_r + above_r;
                *int_g.get_unchecked_mut(y * w + x) = row_sum_g + above_g;
                *int_b.get_unchecked_mut(y * w + x) = row_sum_b + above_b;
            }
        }
    }
    (int_r, int_g, int_b)
}

/// Preprocesses the image by applying blur, pixelation, and contrast/gamma correction.
fn apply_preprocessing(
    data: &mut [u8],
    width: u32,
    height: u32,
    contrast: f32,
    gamma: f32,
    pixelation: u32,
    blur: u32,
) {
    let w = width as usize;
    let h = height as usize;
    let mut temp = data.to_vec();

    // --- Blur Stage ---
    if blur > 0 {
        let radius = blur as usize;
        let (int_r, int_g, int_b) = compute_integral_images(&temp, w, h);
        // Compute the pointer once before entering the parallel loop.
        let data_ptr = data.as_mut_ptr() as usize;
        (0..h).into_par_iter().for_each(|y| {
            let y0 = if y >= radius { y - radius } else { 0 };
            let y1 = (y + radius).min(h - 1);
            for x in 0..w {
                let x0 = if x >= radius { x - radius } else { 0 };
                let x1 = (x + radius).min(w - 1);
                let area = ((x1 - x0 + 1) * (y1 - y0 + 1)) as u32;
                let sum_r = rect_sum(&int_r, w, x0, y0, x1, y1);
                let sum_g = rect_sum(&int_g, w, x0, y0, x1, y1);
                let sum_b = rect_sum(&int_b, w, x0, y0, x1, y1);
                let idx = (y * w + x) * 4;
                unsafe {
                    let ptr = (data_ptr + idx) as *mut u8;
                    *ptr = (sum_r / area) as u8;
                    *ptr.add(1) = (sum_g / area) as u8;
                    *ptr.add(2) = (sum_b / area) as u8;
                }
            }
        });
        temp.copy_from_slice(data);
    }

    // --- Pixelation Stage ---
    if pixelation > 1 {
        let block_size = pixelation as usize;
        let (int_r, int_g, int_b) = compute_integral_images(&temp, w, h);
        let data_ptr = data.as_mut_ptr() as usize;
        (0..h).into_par_iter().for_each(|y| {
            if y % block_size == 0 {
                for x in (0..w).step_by(block_size) {
                    let x0 = x;
                    let y0 = y;
                    let x1 = (x + block_size - 1).min(w - 1);
                    let y1 = (y + block_size - 1).min(h - 1);
                    let area = ((x1 - x0 + 1) * (y1 - y0 + 1)) as u32;
                    let sum_r = rect_sum(&int_r, w, x0, y0, x1, y1);
                    let sum_g = rect_sum(&int_g, w, x0, y0, x1, y1);
                    let sum_b = rect_sum(&int_b, w, x0, y0, x1, y1);
                    let avg_r = (sum_r / area) as u8;
                    let avg_g = (sum_g / area) as u8;
                    let avg_b = (sum_b / area) as u8;
                    for by in y0..=y1 {
                        let base = by * w * 4;
                        for bx in x0..=x1 {
                            let idx = base + bx * 4;
                            unsafe {
                                let ptr = (data_ptr + idx) as *mut u8;
                                *ptr = avg_r;
                                *ptr.add(1) = avg_g;
                                *ptr.add(2) = avg_b;
                            }
                        }
                    }
                }
            }
        });
        temp.copy_from_slice(data);
    }

    // --- Contrast and Gamma Correction Stage ---
    let contrast_factor = contrast / 100.0;
    let mut lut = [0u8; 256];
    for i in 0..256 {
        let pixel = i as f32;
        let contrasted = ((pixel - 128.0) * contrast_factor) + 128.0;
        let normalized = clamp(contrasted / 255.0, 0.0, 1.0);
        let corrected = 255.0 * normalized.powf(1.0 / gamma);
        lut[i] = clamp(corrected, 0.0, 255.0) as u8;
    }
    data.par_chunks_mut(4).for_each(|chunk| {
        // Only adjust RGB channels; leave alpha untouched.
        chunk[0] = lut[chunk[0] as usize];
        chunk[1] = lut[chunk[1] as usize];
        chunk[2] = lut[chunk[2] as usize];
    });
}

// === Dither Parameters and Trait ===

pub struct DitherParams {
    pub threshold: u8,
    pub contrast: f32,
    pub gamma: f32,
    pub pixelation: u32,
    pub blur: u32,
    pub block_scale: u32,
    pub bayer_width: u8,
    pub bayer_height: u8,
}

/// The trait now requires Send + Sync so that it can be stored in a global registry.
pub trait DitherAlgorithm: Send + Sync {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams);
}


// === Generic Error Diffusion Helper ===

fn error_diffusion_generic(
    data: &mut [u8],
    width: u32,
    height: u32,
    threshold: u8,
    kernel: &[(isize, isize, f32)],
    block_scale: u32,
) {
    if block_scale > 1 {
        let bs = block_scale as usize;
        let w = width as usize;
        let h = height as usize;
        let new_w = (w + bs - 1) / bs;
        let new_h = (h + bs - 1) / bs;
        
        // Downsample grayscale values.
        let mut down_gray = vec![0.0; new_w * new_h];
        let mut gray = vec![0.0; w * h];
        for (i, chunk) in data.chunks_exact(4).enumerate() {
            let r = chunk[0] as f32;
            let g = chunk[1] as f32;
            let b = chunk[2] as f32;
            gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        }
        for ny in 0..new_h {
            for nx in 0..new_w {
                let mut sum = 0.0;
                let mut count = 0;
                let y_start = ny * bs;
                let y_end = ((ny + 1) * bs).min(h);
                let x_start = nx * bs;
                let x_end = ((nx + 1) * bs).min(w);
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        sum += gray[y * w + x];
                        count += 1;
                    }
                }
                down_gray[ny * new_w + nx] = sum / (count as f32);
            }
        }
        
        // Apply error diffusion on the downsampled grid.
        for y in 0..new_h {
            for x in 0..new_w {
                let idx = y * new_w + x;
                let old_pixel = down_gray[idx];
                let new_pixel = if old_pixel < threshold as f32 { 0.0 } else { 255.0 };
                let error = old_pixel - new_pixel;
                down_gray[idx] = new_pixel;
                for &(dx, dy, factor) in kernel {
                    let nx = x as isize + dx;
                    let ny = y as isize + dy;
                    if nx >= 0 && nx < new_w as isize && ny >= 0 && ny < new_h as isize {
                        let nidx = (ny as usize) * new_w + (nx as usize);
                        down_gray[nidx] += error * factor;
                    }
                }
            }
        }
        
        // Upscale back into the full resolution data.
        let data_ptr = data.as_mut_ptr() as usize; // store as usize for sharing
        (0..new_h).into_par_iter().for_each(|ny| {
            for nx in 0..new_w {
                let val = down_gray[ny * new_w + nx].round().clamp(0.0, 255.0) as u8;
                let y_start = ny * bs;
                let y_end = ((ny + 1) * bs).min(h);
                let x_start = nx * bs;
                let x_end = ((nx + 1) * bs).min(w);
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        let idx = (y * w + x) * 4;
                        unsafe {
                            let ptr = (data_ptr + idx) as *mut u8;
                            *ptr = val;
                            *ptr.add(1) = val;
                            *ptr.add(2) = val;
                        }
                    }
                }
            }
        });
    
    } else {
        // Full-resolution error diffusion (block_scale == 1)
        let w = width as isize;
        let h = height as isize;
        let mut gray: Vec<f32> = data.chunks_exact(4)
            .map(|chunk| 0.299 * (chunk[0] as f32)
                       + 0.587 * (chunk[1] as f32)
                       + 0.114 * (chunk[2] as f32))
            .collect();
        
        for y in 0..h {
            for x in 0..w {
                let idx = (y * w + x) as usize;
                let old_pixel = gray[idx];
                let new_pixel = if old_pixel < threshold as f32 { 0.0 } else { 255.0 };
                let error = old_pixel - new_pixel;
                gray[idx] = new_pixel;
                for &(dx, dy, factor) in kernel {
                    let nx = x + dx;
                    let ny = y + dy;
                    if nx >= 0 && nx < w && ny >= 0 && ny < h {
                        let nidx = (ny * w + nx) as usize;
                        gray[nidx] += error * factor;
                    }
                }
            }
        }
        let data_ptr = data.as_mut_ptr() as usize;
        for (i, _chunk) in data.chunks_exact_mut(4).enumerate() {
            let val = gray[i].round().clamp(0.0, 255.0) as u8;
            unsafe {
                let ptr = (data_ptr + i * 4) as *mut u8;
                *ptr = val;
                *ptr.add(1) = val;
                *ptr.add(2) = val;
            }
        }
    }
}

// === Kernels for Sierra Variants ===

// Sierra (Sierra‑3): Sum = 32
const SIERRA_KERNEL: &[(isize, isize, f32)] = &[
    (1, 0, 5.0/32.0),
    (2, 0, 3.0/32.0),
    (-2, 1, 2.0/32.0),
    (-1, 1, 4.0/32.0),
    (0, 1, 5.0/32.0),
    (1, 1, 4.0/32.0),
    (2, 1, 2.0/32.0),
    (-1, 2, 2.0/32.0),
    (0, 2, 3.0/32.0),
    (1, 2, 2.0/32.0),
];

// Two-Row Sierra: Sum = 16
const SIERRA_TWO_ROW_KERNEL: &[(isize, isize, f32)] = &[
    (1, 0, 4.0/16.0),
    (2, 0, 3.0/16.0),
    (-2, 1, 1.0/16.0),
    (-1, 1, 2.0/16.0),
    (0, 1, 3.0/16.0),
    (1, 1, 2.0/16.0),
    (2, 1, 1.0/16.0),
];

// Sierra Lite: Sum = 4
const SIERRA_LITE_KERNEL: &[(isize, isize, f32)] = &[
    (1, 0, 2.0/4.0),
    (0, 1, 1.0/4.0),
    (1, 1, 1.0/4.0),
];

// === Sierra Dithering Implementations ===

pub struct SierraDither;
impl DitherAlgorithm for SierraDither {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams) {
         apply_preprocessing(data, width, height, params.contrast, params.gamma, params.pixelation, params.blur);
         error_diffusion_generic(data, width, height, params.threshold, SIERRA_KERNEL, params.block_scale);
    }
}

pub struct SierraTwoRowDither;
impl DitherAlgorithm for SierraTwoRowDither {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams) {
         apply_preprocessing(data, width, height, params.contrast, params.gamma, params.pixelation, params.blur);
         error_diffusion_generic(data, width, height, params.threshold, SIERRA_TWO_ROW_KERNEL, params.block_scale);
    }
}

pub struct SierraLiteDither;
impl DitherAlgorithm for SierraLiteDither {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams) {
         apply_preprocessing(data, width, height, params.contrast, params.gamma, params.pixelation, params.blur);
         error_diffusion_generic(data, width, height, params.threshold, SIERRA_LITE_KERNEL, params.block_scale);
    }
}

// === Algorithm Implementations ===

// Threshold Dithering
pub struct ThresholdDither;
impl DitherAlgorithm for ThresholdDither {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams) {
         apply_preprocessing(data, width, height, params.contrast, params.gamma, params.pixelation, params.blur);
         let total_pixels = data.len() / 4;
         let data_ptr = data.as_mut_ptr() as usize;
         (0..total_pixels).into_par_iter().for_each(|i| {
             let idx = i * 4;
             unsafe {
                 let ptr = (data_ptr + idx) as *mut u8;
                 let r = *ptr as f32;
                 let g = *ptr.add(1) as f32;
                 let b = *ptr.add(2) as f32;
                 let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                 let new_value = if luminance < params.threshold as f32 { 0 } else { 255 };
                 *ptr = new_value;
                 *ptr.add(1) = new_value;
                 *ptr.add(2) = new_value;
             }
         });
    }
}

// Floyd–Steinberg Dithering
pub struct FloydSteinbergDither;
impl DitherAlgorithm for FloydSteinbergDither {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams) {
         floyd_steinberg_dither_impl(
             data,
             width,
             height,
             params.threshold,
             params.contrast,
             params.gamma,
             params.pixelation,
             params.blur,
             params.block_scale,
         );
    }
}

fn floyd_steinberg_dither_impl(
    data: &mut [u8],
    width: u32,
    height: u32,
    threshold: u8,
    contrast: f32,
    gamma: f32,
    pixelation: u32,
    blur: u32,
    block_scale: u32,
) {
    apply_preprocessing(data, width, height, contrast, gamma, pixelation, blur);
    let w = width as usize;
    let h = height as usize;
    let mut gray: Vec<f32> = data.chunks_exact(4)
        .map(|chunk| 0.299 * (chunk[0] as f32)
                   + 0.587 * (chunk[1] as f32)
                   + 0.114 * (chunk[2] as f32))
        .collect();
    
    if block_scale > 1 {
        let bs = block_scale as usize;
        let new_w = (w + bs - 1) / bs;
        let new_h = (h + bs - 1) / bs;
        let mut down_gray = vec![0.0; new_w * new_h];
        let down_gray_ptr = down_gray.as_mut_ptr() as usize;
        (0..new_h).into_par_iter().for_each(|ny| {
            for nx in 0..new_w {
                let mut sum = 0.0;
                let mut count = 0;
                let y_start = ny * bs;
                let y_end = ((ny + 1) * bs).min(h);
                let x_start = nx * bs;
                let x_end = ((nx + 1) * bs).min(w);
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        sum += gray[y * w + x];
                        count += 1;
                    }
                }
                unsafe {
                    let ptr = (down_gray_ptr + (ny * new_w + nx) * size_of::<f32>()) as *mut f32;
                    *ptr = sum / (count as f32);
                }
            }
        });
        for ny in 0..new_h {
            for nx in 0..new_w {
                let idx = ny * new_w + nx;
                let old_pixel = down_gray[idx];
                let new_pixel = if old_pixel < threshold as f32 { 0.0 } else { 255.0 };
                let error = old_pixel - new_pixel;
                down_gray[idx] = new_pixel;
                if nx + 1 < new_w {
                    down_gray[idx + 1] += error * 7.0 / 16.0;
                }
                if nx > 0 && ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + (nx - 1)] += error * 3.0 / 16.0;
                }
                if ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + nx] += error * 5.0 / 16.0;
                }
                if nx + 1 < new_w && ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + (nx + 1)] += error * 1.0 / 16.0;
                }
            }
        }
        let data_ptr = data.as_mut_ptr() as usize;
        (0..new_h).into_par_iter().for_each(|ny| {
            for nx in 0..new_w {
                let val = down_gray[ny * new_w + nx].round().clamp(0.0, 255.0) as u8;
                let y_start = ny * bs;
                let y_end = ((ny + 1) * bs).min(h);
                let x_start = nx * bs;
                let x_end = ((nx + 1) * bs).min(w);
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        let idx = (y * w + x) * 4;
                        unsafe {
                            let ptr = (data_ptr + idx) as *mut u8;
                            *ptr = val;
                            *ptr.add(1) = val;
                            *ptr.add(2) = val;
                        }
                    }
                }
            }
        });
    } else {
        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                let old_pixel = gray[idx];
                let new_pixel = if old_pixel < threshold as f32 { 0.0 } else { 255.0 };
                let error = old_pixel - new_pixel;
                gray[idx] = new_pixel;
                if x + 1 < w {
                    gray[idx + 1] += error * 7.0 / 16.0;
                }
                if x > 0 && y + 1 < h {
                    gray[idx + w - 1] += error * 3.0 / 16.0;
                }
                if y + 1 < h {
                    gray[idx + w] += error * 5.0 / 16.0;
                }
                if x + 1 < w && y + 1 < h {
                    gray[idx + w + 1] += error * 1.0 / 16.0;
                }
            }
        }
        let data_ptr = data.as_mut_ptr() as usize;
        for (i, _chunk) in data.chunks_exact_mut(4).enumerate() {
            let val = gray[i].round().clamp(0.0, 255.0) as u8;
            unsafe {
                let ptr = (data_ptr + i * 4) as *mut u8;
                *ptr = val;
                *ptr.add(1) = val;
                *ptr.add(2) = val;
            }
        }
    }
}

// === Ordered Bayer Dithering Implementation ===

fn generate_bayer_matrix(width: u8, height: u8) -> Vec<Vec<u8>> {
    let w = width as usize;
    let h = height as usize;
    let total = w * h;
    let mut matrix = vec![vec![0u8; w]; h];
    let mut used = vec![vec![false; w]; h];
    // Place 0 at top-left
    used[0][0] = true;
    matrix[0][0] = 0;
    let mut placed_positions = vec![(0, 0)];
    for value in 1..total {
        let mut best_dist = -1;
        let mut best_pos = (0, 0);
        for y in 0..h {
            for x in 0..w {
                if used[y][x] {
                    continue;
                }
                let mut min_dist = i32::MAX;
                for &(py, px) in &placed_positions {
                    let dx = (x as i32 - px as i32).abs();
                    let dy = (y as i32 - py as i32).abs();
                    let toroidal_dx = std::cmp::min(dx, w as i32 - dx);
                    let toroidal_dy = std::cmp::min(dy, h as i32 - dy);
                    let dist = toroidal_dx + toroidal_dy;
                    if dist < min_dist {
                        min_dist = dist;
                    }
                }
                if min_dist > best_dist {
                    best_dist = min_dist;
                    best_pos = (y, x);
                }
            }
        }
        matrix[best_pos.0][best_pos.1] = value as u8;
        used[best_pos.0][best_pos.1] = true;
        placed_positions.push(best_pos);
    }
    matrix
}

fn ordered_dither_bayer_impl(
    data: &mut [u8],
    width: u32,
    height: u32,
    contrast: f32,
    gamma: f32,
    pixelation: u32,
    blur: u32,
    block_scale: u32,
    matrix_width: u8,
    matrix_height: u8,
) {
    // Preprocess image
    apply_preprocessing(data, width, height, contrast, gamma, pixelation, blur);
    let w = width as usize;
    let h = height as usize;
    let bs = block_scale as usize;
    let mat_w = matrix_width.max(1) as usize;
    let mat_h = matrix_height.max(1) as usize;
    let bayer_matrix = generate_bayer_matrix(matrix_width.max(1), matrix_height.max(1));
    let total_values = (mat_w * mat_h) as f32;
    if bs > 1 {
        let data_ptr = data.as_mut_ptr() as usize;
        (0..(h + bs - 1) / bs).into_par_iter().for_each(|by| {
            let y_start = by * bs;
            let y_end = ((by + 1) * bs).min(h);
            for bx in 0..((w + bs - 1) / bs) {
                let x_start = bx * bs;
                let x_end = ((bx + 1) * bs).min(w);
                let mut sum = 0.0;
                let mut count = 0;
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        let idx = (y * w + x) * 4;
                        unsafe {
                            let ptr = (data_ptr + idx) as *mut u8;
                            let r = *ptr as f32;
                            let g = *ptr.add(1) as f32;
                            let b = *ptr.add(2) as f32;
                            sum += 0.299 * r + 0.587 * g + 0.114 * b;
                        }
                        count += 1;
                    }
                }
                let avg = sum / (count as f32);
                let center_y = (y_start + ((y_end - y_start) / 2)) % mat_h;
                let center_x = (x_start + ((x_end - x_start) / 2)) % mat_w;
                let matrix_value = bayer_matrix[center_y][center_x] as f32;
                let dither_threshold = ((matrix_value + 0.5) / total_values) * 255.0;
                let new_val = if avg < dither_threshold { 0 } else { 255 };
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        let idx = (y * w + x) * 4;
                        unsafe {
                            let ptr = (data_ptr + idx) as *mut u8;
                            *ptr = new_val;
                            *ptr.add(1) = new_val;
                            *ptr.add(2) = new_val;
                        }
                    }
                }
            }
        });
    } else {
        let data_ptr = data.as_mut_ptr() as usize;
        (0..h).into_par_iter().for_each(|y| {
            for x in 0..w {
                let idx = (y * w + x) * 4;
                unsafe {
                    let ptr = (data_ptr + idx) as *mut u8;
                    let r = *ptr as f32;
                    let g = *ptr.add(1) as f32;
                    let b = *ptr.add(2) as f32;
                    let lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    let matrix_value = bayer_matrix[y % mat_h][x % mat_w] as f32;
                    let dither_threshold = ((matrix_value + 0.5) / total_values) * 255.0;
                    let new_val = if lum < dither_threshold { 0 } else { 255 };
                    *ptr = new_val;
                    *ptr.add(1) = new_val;
                    *ptr.add(2) = new_val;
                }
            }
        });
    }
}

// DitherAlgorithm Implementation for dynamic Bayer
pub struct BayerDither;
impl DitherAlgorithm for BayerDither {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams) {
        ordered_dither_bayer_impl(
            data,
            width,
            height,
            params.contrast,
            params.gamma,
            params.pixelation,
            params.blur,
            params.block_scale,
            params.bayer_width,
            params.bayer_height,
        );
    }
}


// Jarvis–Judice–Ninke Dithering
pub struct JarvisJudiceNinkeDither;
impl DitherAlgorithm for JarvisJudiceNinkeDither {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams) {
         jarvis_judice_ninke_dither_impl(
             data,
             width,
             height,
             params.threshold,
             params.contrast,
             params.gamma,
             params.pixelation,
             params.blur,
             params.block_scale,
         );
    }
}

fn jarvis_judice_ninke_dither_impl(
    data: &mut [u8],
    width: u32,
    height: u32,
    threshold: u8,
    contrast: f32,
    gamma: f32,
    pixelation: u32,
    blur: u32,
    block_scale: u32,
) {
    apply_preprocessing(data, width, height, contrast, gamma, pixelation, blur);
    let w = width as usize;
    let h = height as usize;
    let mut gray: Vec<f32> = data.chunks_exact(4)
        .map(|chunk| 0.299 * (chunk[0] as f32)
                   + 0.587 * (chunk[1] as f32)
                   + 0.114 * (chunk[2] as f32))
        .collect();
    if block_scale > 1 {
        let bs = block_scale as usize;
        let new_w = (w + bs - 1) / bs;
        let new_h = (h + bs - 1) / bs;
        let mut down_gray = vec![0.0; new_w * new_h];
        let down_gray_ptr = down_gray.as_mut_ptr() as usize;
        (0..new_h).into_par_iter().for_each(|ny| {
            for nx in 0..new_w {
                let mut sum = 0.0;
                let mut count = 0;
                let y_start = ny * bs;
                let y_end = ((ny + 1) * bs).min(h);
                let x_start = nx * bs;
                let x_end = ((nx + 1) * bs).min(w);
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        sum += gray[y * w + x];
                        count += 1;
                    }
                }
                unsafe {
                    let ptr = (down_gray_ptr + (ny * new_w + nx) * size_of::<f32>()) as *mut f32;
                    *ptr = sum / (count as f32);
                }
            }
        });
        for ny in 0..new_h {
            for nx in 0..new_w {
                let idx = ny * new_w + nx;
                let old_pixel = down_gray[idx];
                let new_pixel = if old_pixel < threshold as f32 { 0.0 } else { 255.0 };
                let error = old_pixel - new_pixel;
                down_gray[idx] = new_pixel;
                if nx + 1 < new_w {
                    down_gray[idx + 1] += error * 7.0 / 48.0;
                }
                if nx > 0 && ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + (nx - 1)] += error * 5.0 / 48.0;
                }
                if ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + nx] += error * 7.0 / 48.0;
                }
                if nx + 1 < new_w && ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + (nx + 1)] += error * 5.0 / 48.0;
                }
            }
        }
        let data_ptr = data.as_mut_ptr() as usize;
        (0..new_h).into_par_iter().for_each(|ny| {
            for nx in 0..new_w {
                let val = down_gray[ny * new_w + nx].round().clamp(0.0, 255.0) as u8;
                let y_start = ny * bs;
                let y_end = ((ny + 1) * bs).min(h);
                let x_start = nx * bs;
                let x_end = ((nx + 1) * bs).min(w);
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        let idx = (y * w + x) * 4;
                        unsafe {
                            let ptr = (data_ptr + idx) as *mut u8;
                            *ptr = val;
                            *ptr.add(1) = val;
                            *ptr.add(2) = val;
                        }
                    }
                }
            }
        });
    } else {
        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                let old_pixel = gray[idx];
                let new_pixel = if old_pixel < threshold as f32 { 0.0 } else { 255.0 };
                let error = old_pixel - new_pixel;
                gray[idx] = new_pixel;
                if x + 1 < w {
                    gray[idx + 1] += error * 7.0 / 48.0;
                }
                if x + 2 < w {
                    gray[y * w + (x + 2)] += error * 5.0 / 48.0;
                }
                if y + 1 < h {
                    if x >= 2 {
                        gray[(y + 1) * w + (x - 2)] += error * 3.0 / 48.0;
                    }
                    if x >= 1 {
                        gray[(y + 1) * w + (x - 1)] += error * 5.0 / 48.0;
                    }
                    gray[(y + 1) * w + x] += error * 7.0 / 48.0;
                    if x + 1 < w {
                        gray[(y + 1) * w + (x + 1)] += error * 5.0 / 48.0;
                    }
                    if x + 2 < w {
                        gray[(y + 1) * w + (x + 2)] += error * 3.0 / 48.0;
                    }
                }
                if y + 2 < h {
                    if x >= 2 {
                        gray[(y + 2) * w + (x - 2)] += error * 1.0 / 48.0;
                    }
                    if x >= 1 {
                        gray[(y + 2) * w + (x - 1)] += error * 3.0 / 48.0;
                    }
                    gray[(y + 2) * w + x] += error * 5.0 / 48.0;
                    if x + 1 < w {
                        gray[(y + 2) * w + (x + 1)] += error * 3.0 / 48.0;
                    }
                    if x + 2 < w {
                        gray[(y + 2) * w + (x + 2)] += error * 1.0 / 48.0;
                    }
                }
            }
        }
        let data_ptr = data.as_mut_ptr() as usize;
        data.chunks_exact_mut(4).enumerate().for_each(|(i, _)| {
            let val = gray[i].round().clamp(0.0, 255.0) as u8;
            unsafe {
                let ptr = (data_ptr + i * 4) as *mut u8;
                *ptr = val;
                *ptr.add(1) = val;
                *ptr.add(2) = val;
            }
        });
    }
}

// Atkinson Dithering
pub struct AtkinsonDither;
impl DitherAlgorithm for AtkinsonDither {
    fn apply(&self, data: &mut [u8], width: u32, height: u32, params: &DitherParams) {
         atkinson_dither_impl(
             data,
             width,
             height,
             params.threshold,
             params.contrast,
             params.gamma,
             params.pixelation,
             params.blur,
             params.block_scale,
         );
    }
}

fn atkinson_dither_impl(
    data: &mut [u8],
    width: u32,
    height: u32,
    threshold: u8,
    contrast: f32,
    gamma: f32,
    pixelation: u32,
    blur: u32,
    block_scale: u32,
) {
    apply_preprocessing(data, width, height, contrast, gamma, pixelation, blur);
    let w = width as usize;
    let h = height as usize;
    let mut gray: Vec<f32> = data.chunks_exact(4)
        .map(|chunk| 0.299 * (chunk[0] as f32)
                   + 0.587 * (chunk[1] as f32)
                   + 0.114 * (chunk[2] as f32))
        .collect();
    if block_scale > 1 {
        let bs = block_scale as usize;
        let new_w = (w + bs - 1) / bs;
        let new_h = (h + bs - 1) / bs;
        let mut down_gray = vec![0.0; new_w * new_h];
        let down_gray_ptr = down_gray.as_mut_ptr() as usize;
        (0..new_h).into_par_iter().for_each(|ny| {
            for nx in 0..new_w {
                let mut sum = 0.0;
                let mut count = 0;
                let y_start = ny * bs;
                let y_end = ((ny + 1) * bs).min(h);
                let x_start = nx * bs;
                let x_end = ((nx + 1) * bs).min(w);
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        sum += gray[y * w + x];
                        count += 1;
                    }
                }
                unsafe {
                    let ptr = (down_gray_ptr + (ny * new_w + nx) * size_of::<f32>()) as *mut f32;
                    *ptr = sum / (count as f32);
                }
            }
        });
        for ny in 0..new_h {
            for nx in 0..new_w {
                let idx = ny * new_w + nx;
                let old_pixel = down_gray[idx];
                let new_pixel = if old_pixel < threshold as f32 { 0.0 } else { 255.0 };
                let error = old_pixel - new_pixel;
                down_gray[idx] = new_pixel;
                if nx + 1 < new_w {
                    down_gray[idx + 1] += error * 7.0 / 48.0;
                }
                if nx > 0 && ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + (nx - 1)] += error * 5.0 / 48.0;
                }
                if ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + nx] += error * 7.0 / 48.0;
                }
                if nx + 1 < new_w && ny + 1 < new_h {
                    down_gray[(ny + 1) * new_w + (nx + 1)] += error * 5.0 / 48.0;
                }
            }
        }
        let data_ptr = data.as_mut_ptr() as usize;
        (0..new_h).into_par_iter().for_each(|ny| {
            for nx in 0..new_w {
                let val = down_gray[ny * new_w + nx].round().clamp(0.0, 255.0) as u8;
                let y_start = ny * bs;
                let y_end = ((ny + 1) * bs).min(h);
                let x_start = nx * bs;
                let x_end = ((nx + 1) * bs).min(w);
                for y in y_start..y_end {
                    for x in x_start..x_end {
                        let idx = (y * w + x) * 4;
                        unsafe {
                            let ptr = (data_ptr + idx) as *mut u8;
                            *ptr = val;
                            *ptr.add(1) = val;
                            *ptr.add(2) = val;
                        }
                    }
                }
            }
        });
    } else {
        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                let old_pixel = gray[idx];
                let new_pixel = if old_pixel < threshold as f32 { 0.0 } else { 255.0 };
                let error = old_pixel - new_pixel;
                gray[idx] = new_pixel;
                let distributed_error = error / 8.0;
                if x + 1 < w {
                    gray[y * w + (x + 1)] += distributed_error;
                }
                if x + 2 < w {
                    gray[y * w + (x + 2)] += distributed_error;
                }
                if y + 1 < h {
                    if x > 0 {
                        gray[(y + 1) * w + (x - 1)] += distributed_error;
                    }
                    gray[(y + 1) * w + x] += distributed_error;
                    if x + 1 < w {
                        gray[(y + 1) * w + (x + 1)] += distributed_error;
                    }
                }
                if y + 2 < h {
                    gray[(y + 2) * w + x] += distributed_error;
                }
            }
        }
        let data_ptr = data.as_mut_ptr() as usize;
        data.chunks_exact_mut(4).enumerate().for_each(|(i, _)| {
            let val = gray[i].round().clamp(0.0, 255.0) as u8;
            unsafe {
                let ptr = (data_ptr + i * 4) as *mut u8;
                *ptr = val;
                *ptr.add(1) = val;
                *ptr.add(2) = val;
            }
        });
    }
}

// Error diffusion kernels (e.g., SIERRA_KERNEL, SIERRA_TWO_ROW_KERNEL, SIERRA_LITE_KERNEL) are defined elsewhere in the code.

static ALGORITHM_REGISTRY: Lazy<HashMap<&'static str, Box<dyn DitherAlgorithm>>> = Lazy::new(|| {
    let mut m: HashMap<&'static str, Box<dyn DitherAlgorithm>> = HashMap::new();
    m.insert("threshold", Box::new(ThresholdDither));
    m.insert("floyd-steinberg", Box::new(FloydSteinbergDither));
    m.insert("bayer", Box::new(BayerDither));
    m.insert("jarvis", Box::new(JarvisJudiceNinkeDither));
    m.insert("atkinson", Box::new(AtkinsonDither));
    m.insert("sierra", Box::new(SierraDither));
    m.insert("sierra-two-row", Box::new(SierraTwoRowDither));
    m.insert("sierra-lite", Box::new(SierraLiteDither));
    m
});

#[wasm_bindgen]
pub fn apply_dither(
    algorithm: &str,
    data: &mut [u8],
    width: u32,
    height: u32,
    threshold: u8,
    contrast: f32,
    gamma: f32,
    pixelation: u32,
    blur: u32,
    block_scale: u32,
    bayer_width: u8,
    bayer_height: u8,
) {
    // Step 1: Backup original RGBA data.
    let backup = data.to_vec();

    // Step 2: Premultiply RGB channels by alpha.
    for chunk in data.chunks_exact_mut(4) {
        let a = chunk[3] as f32 / 255.0;
        chunk[0] = (chunk[0] as f32 * a).round() as u8;
        chunk[1] = (chunk[1] as f32 * a).round() as u8;
        chunk[2] = (chunk[2] as f32 * a).round() as u8;
        // Alpha remains unchanged.
    }

    // Step 3: Apply selected dithering algorithm.
    let params = DitherParams {
        threshold,
        contrast,
        gamma,
        pixelation,
        blur,
        block_scale,
        bayer_width,
        bayer_height,
    };
    if let Some(alg) = ALGORITHM_REGISTRY.get(algorithm) {
         alg.apply(data, width, height, &params);
    } else {
         // Fallback to threshold dithering if algorithm not found.
         ThresholdDither.apply(data, width, height, &params);
    }

    // Step 4: Un-premultiply RGB channels.
    for chunk in data.chunks_exact_mut(4) {
        let alpha = chunk[3];
        if alpha > 0 {
            let inv = 255.0 / (alpha as f32);
            chunk[0] = ((chunk[0] as f32 * inv).round()).min(255.0) as u8;
            chunk[1] = ((chunk[1] as f32 * inv).round()).min(255.0) as u8;
            chunk[2] = ((chunk[2] as f32 * inv).round()).min(255.0) as u8;
        }
    }

    // Step 5: Restore original RGBA for non-opaque pixels.
    for (i, chunk) in data.chunks_exact_mut(4).enumerate() {
        let orig_alpha = backup[i * 4 + 3];
        if orig_alpha != 255 {
            chunk[0] = backup[i * 4];
            chunk[1] = backup[i * 4 + 1];
            chunk[2] = backup[i * 4 + 2];
            chunk[3] = orig_alpha;
        }
    }
}

