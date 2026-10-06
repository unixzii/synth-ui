// Halation: a blur down a chain of half-size targets and back up, each
// level reaching twice as far.

struct Level {
  /// The target's size.
  dst: vec2f,
  /// A step in the source, in its texture coordinates.
  texel: vec2f,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: Level;

fn at(uv: vec2f) -> vec3f {
  return textureSampleLevel(src, samp, uv, 0.0).rgb;
}

@fragment
fn down(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.dst;
  let d = u.texel;
  var s = at(uv) * 4.0;
  s += at(uv - d);
  s += at(uv + d);
  s += at(uv + vec2f(d.x, -d.y));
  s += at(uv - vec2f(d.x, -d.y));
  return vec4f(s / 8.0, 1.0);
}

@fragment
fn up(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / u.dst;
  let h = u.texel;
  var s = at(uv + vec2f(-2.0 * h.x, 0.0));
  s += at(uv + vec2f(-h.x, h.y)) * 2.0;
  s += at(uv + vec2f(0.0, 2.0 * h.y));
  s += at(uv + vec2f(h.x, h.y)) * 2.0;
  s += at(uv + vec2f(2.0 * h.x, 0.0));
  s += at(uv + vec2f(h.x, -h.y)) * 2.0;
  s += at(uv + vec2f(0.0, -2.0 * h.y));
  s += at(uv + vec2f(-h.x, -h.y)) * 2.0;
  return vec4f(s / 12.0, 1.0);
}
