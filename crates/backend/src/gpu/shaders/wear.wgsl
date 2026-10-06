// Wear builds up like a charging capacitor: the more worn, the less more
// wear does, so it creeps towards dead rather than overshooting.

struct Wear {
  rate: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(2) var wear_src: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: Wear;

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let t = vec2i(pos.xy);
  let w = textureLoad(wear_src, t, 0).rgb;
  return vec4f(1.0 - (1.0 - w) * exp(-u.rate * color_at(t)), 1.0);
}
