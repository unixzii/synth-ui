// No effects: each virtual pixel a hard-edged block, sampled "sharp
// bilinear" so only the device pixels straddling an edge blend.

struct Plain {
  /// The picture's size and top left on the drawable, in device pixels.
  out_size: vec2f,
  origin: vec2f,
}

@group(0) @binding(2) var<uniform> u: Plain;

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(index_tex));
  let scale = u.out_size / size;
  let v = (pos.xy - u.origin) / scale - 0.5;
  let i = floor(v);
  let t = clamp((fract(v) - 0.5) * scale + 0.5, vec2f(0.0), vec2f(1.0));
  let k = vec2i(i);
  let top = mix(color_at(k), color_at(k + vec2i(1, 0)), t.x);
  let bottom = mix(color_at(k + vec2i(0, 1)), color_at(k + vec2i(1, 1)), t.x);
  return vec4f(to_srgb(mix(top, bottom, t.y)), 1.0);
}
