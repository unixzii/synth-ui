// Shared by every pass: one triangle covering the target, and sRGB <-> linear.

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn to_linear(c: vec3f) -> vec3f {
  return select(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), c >= vec3f(0.04045));
}

fn to_srgb(x: vec3f) -> vec3f {
  let c = clamp(x, vec3f(0.0), vec3f(1.0));
  return select(c * 12.92, 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c >= vec3f(0.0031308));
}
