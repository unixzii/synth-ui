// Each pixel's light: its colour, less what wear has taken, or what's left
// of the last frame's as it fades, whichever is brighter.

struct Phosphor {
  decay: vec4f,
}

@group(0) @binding(2) var wear_tex: texture_2d<f32>;
@group(0) @binding(3) var prev_tex: texture_2d<f32>;
@group(0) @binding(4) var<uniform> u: Phosphor;

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let t = vec2i(pos.xy);
  let lit = color_at(t) * (1.0 - textureLoad(wear_tex, t, 0).rgb);
  return vec4f(max(lit, textureLoad(prev_tex, t, 0).rgb * u.decay.rgb), 1.0);
}
