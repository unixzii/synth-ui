// The frame as palette indices, and the palette: a virtual pixel's colour, as light.

@group(0) @binding(0) var index_tex: texture_2d<f32>;
@group(0) @binding(1) var palette_tex: texture_2d<f32>;

/// Linear colour of virtual pixel `t` (top-down, clamped to the frame).
fn color_at(p: vec2i) -> vec3f {
  let size = vec2i(textureDimensions(index_tex));
  let t = clamp(p, vec2i(0), size - 1);
  let i = i32(textureLoad(index_tex, t, 0).r * 255.0 + 0.5);
  return to_linear(textureLoad(palette_tex, vec2i(i, 0), 0).rgb);
}
