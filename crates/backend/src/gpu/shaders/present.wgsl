// The tube, at device resolution: each row of pixels is a beam with a
// Gaussian profile that widens with brightness (thin dark gaps between dim
// rows, bright rows fat enough to close them), through the phosphor mask,
// plus the light scattered in the glass, falling off towards the corners,
// plus the room light the faceplate reflects, which worn phosphor, browned,
// reflects less of. Across a row, pixels are sampled sharp bilinear.

struct Present {
  out_size: vec2f,
  origin: vec2f,
  halo_texel: vec2f,
  sigma_dim: f32,
  sigma_bright: f32,
  mask_low: f32,
  mask_gain: f32,
  halation: f32,
  halo_scale: f32,
  ambient: f32,
  vignette: f32,
  /// 0 none, 1 aperture grille, 2 slot mask, 3 shadow mask.
  mask: i32,
  _pad: i32,
}

@group(0) @binding(0) var light_tex: texture_2d<f32>;
@group(0) @binding(1) var wear_tex: texture_2d<f32>;
@group(0) @binding(2) var halo_tex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<uniform> u: Present;

/// A row's light at column position x, blended sharp-bilinear across the pixel edge. Nothing beyond the top and bottom.
fn row_light(size: vec2f, ix: f32, tx: f32, row: f32) -> vec3f {
  if (row < 0.0 || row >= size.y) {
    return vec3f(0.0);
  }
  let y = i32(row);
  let x0 = i32(clamp(ix, 0.0, size.x - 1.0));
  let x1 = i32(clamp(ix + 1.0, 0.0, size.x - 1.0));
  return mix(textureLoad(light_tex, vec2i(x0, y), 0).rgb, textureLoad(light_tex, vec2i(x1, y), 0).rgb, tx);
}

fn halo_at(uv: vec2f) -> vec3f {
  return textureSampleLevel(halo_tex, samp, uv, 0.0).rgb;
}

/// The halo target is coarser than the grid; a 3×3 tent keeps it smooth however far it's magnified.
fn halo(uv: vec2f) -> vec3f {
  let d = u.halo_texel;
  var s = halo_at(uv) * 4.0;
  s += (halo_at(uv + vec2f(d.x, 0.0)) + halo_at(uv - vec2f(d.x, 0.0)) + halo_at(uv + vec2f(0.0, d.y)) + halo_at(uv - vec2f(0.0, d.y))) * 2.0;
  s += halo_at(uv + d) + halo_at(uv - d) + halo_at(uv + vec2f(d.x, -d.y)) + halo_at(uv - vec2f(d.x, -d.y));
  return s / 16.0;
}

/// Which phosphor device pixel `p` (counted from the bottom left) is: the lit channel full, the others at mask_low.
fn mask(p: vec2i) -> vec3f {
  if (u.mask == 0) {
    return vec3f(1.0);
  }
  var ch = p.x % 3;
  // Shadow mask: dots, each row of triads a dot along from the one above.
  if (u.mask == 3) {
    ch = (p.x + (p.y % 2)) % 3;
  }
  var m = vec3f(u.mask_low);
  // Slot mask: the stripes broken every 4 rows, staggered between neighbouring triads.
  if (u.mask == 2 && (p.y + ((p.x / 3) % 2) * 2) % 4 == 0) {
    return m;
  }
  m[ch] = 1.0;
  return m;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(light_tex));
  let scale = u.out_size / size;
  let local = pos.xy - u.origin;
  let v = local / scale; // virtual position, top-down

  let ux = v.x - 0.5;
  let ix = floor(ux);
  let tx = clamp((fract(ux) - 0.5) * scale.x + 0.5, 0.0, 1.0);

  // Rows too few device pixels tall can't show a gap cleanly: the beam
  // thickens towards flat there. And each beam is widened by the height of a
  // device pixel, so thin ones are sampled smoothly rather than aliasing.
  let thin = smoothstep(1.5, 2.5, scale.y);
  let dim = mix(0.6, u.sigma_dim, thin);
  let bright = mix(0.6, u.sigma_bright, thin);
  let aa = 1.0 / (12.0 * scale.y * scale.y);
  let row = floor(v.y);
  var c = vec3f(0.0);
  for (var k = -2; k <= 2; k++) {
    let r = row + f32(k);
    let light = row_light(size, ix, tx, r);
    var s = mix(vec3f(dim), vec3f(bright), sqrt(clamp(light, vec3f(0.0), vec3f(1.0))));
    s = sqrt(s * s + aa);
    let d = v.y - (r + 0.5);
    // Normalised: however wide, a beam carries its row's light, no more.
    c += light * exp(-0.5 * d * d / (s * s)) / (s * 2.5066283);
  }
  let p = vec2i(i32(floor(local.x)), i32(u.out_size.y) - 1 - i32(floor(local.y)));
  c *= mask(p) * u.mask_gain;

  // The scattered light carries none of the mask or the rows: it left them behind in the glass.
  let uv = v / size;
  c = mix(c, halo(uv) * u.halo_scale, u.halation);

  let q = uv * 2.0 - 1.0;
  c *= max(0.0, 1.0 - u.vignette * 0.5 * dot(q, q));

  // Browned phosphor absorbs more blue than red.
  let w = textureSampleLevel(wear_tex, samp, uv, 0.0).rgb;
  let worn = (w.r + w.g + w.b) / 3.0;
  c += u.ambient * (1.0 - worn * vec3f(0.35, 0.5, 0.7));
  return vec4f(to_srgb(c), 1.0);
}
