// The rasterizer, pixel for pixel: the same expectations the TypeScript
// renderer was held to.

use synth_backend::raster::{Bitmap, BitmapFont, ColorMap, FontFace, FontRegistry, Rect, SOLID, StrengthField, Surface};
use synth_backend::{Blend, DrawList};

// A 3×3 face with a narrow I, caps only.
fn face() -> FontFace {
    FontFace {
        caps: true,
        glyphs: [("?", "### ..# .#."), ("A", ".#. ### #.#"), ("I", "# # #"), (" ", "... ... ...")].into_iter().map(|(c, r)| (c.to_string(), r.to_string())).collect(),
        ..Default::default()
    }
}

fn fonts() -> FontRegistry {
    FontRegistry::new(&[("face".into(), face())], None).unwrap()
}

fn rows(s: &Surface) -> Vec<String> {
    s.data().chunks(s.width()).map(|r| r.iter().map(|v| v.to_string()).collect()).collect()
}

/// The ordered-dither pattern with `level` of its sixteen pixels set, as core's `dither()`.
fn dither(level: u8) -> u16 {
    const BAYER: [u8; 16] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    (0..16).filter(|&i| BAYER[i] < level).fold(0, |m, i| m | 1 << i)
}

#[test]
fn fills_rectangles_clipped_to_the_surface() {
    let mut s = Surface::new(4, 3);
    s.fill_rect(-1, 1, 3, 5, 7, SOLID);
    assert_eq!(rows(&s), ["0000", "7700", "7700"]);
}

#[test]
fn draws_through_the_clip() {
    let mut s = Surface::new(5, 3);
    s.set_clip(Some(Rect::new(1, 1, 2, 1)));
    s.fill_rect(1, 1, 4, 4, 1, SOLID);
    s.set_clip(None);
    s.pset(4, 2, 2);
    assert_eq!(rows(&s), ["00000", "01100", "00002"]);
}

#[test]
fn draws_one_pixel_outlines_and_bresenham_lines_with_both_ends() {
    let mut s = Surface::new(4, 4);
    s.rect(0, 0, 4, 4, 1);
    assert_eq!(rows(&s), ["1111", "1001", "1001", "1111"]);
    let mut t = Surface::new(4, 4);
    t.line(0, 0, 3, 3, 1);
    assert_eq!(rows(&t), ["1000", "0100", "0010", "0001"]);
}

#[test]
fn draws_symmetric_circles() {
    let mut s = Surface::new(7, 7);
    s.circle(3, 3, 3, 1);
    let r = rows(&s);
    assert_eq!(r, r.iter().rev().cloned().collect::<Vec<_>>());
    assert_eq!(r, r.iter().map(|l| l.chars().rev().collect::<String>()).collect::<Vec<_>>());
    assert_eq!(r[0], "0011100");
}

#[test]
fn remaps_indices_through_a_colour_map() {
    let mut s = Surface::new(2, 1);
    s.data_mut().copy_from_slice(&[1, 2]);
    let mut map: ColorMap = std::array::from_fn(|i| i as u8);
    map[2] = 9;
    s.remap(0, 0, 2, 1, &map, SOLID);
    assert_eq!(s.data(), [1, 9]);
}

#[test]
fn pixelates_a_rectangle_into_blocks_of_their_centre_colour() {
    let mut s = Surface::new(6, 4);
    for y in 0..4 {
        for x in 0..6 {
            s.pset(x, y, (y * 6 + x) as u8);
        }
    }
    s.mosaic(1, 0, 5, 4, 2);
    // Column 0 is outside; blocks start at x=1, the last one only one pixel wide.
    assert_eq!(s.data()[0..6], [0, 8, 8, 10, 10, 11]);
    assert_eq!(s.data()[6..12], [6, 8, 8, 10, 10, 11]);
    assert_eq!(s.data()[18..24], [18, 20, 20, 22, 22, 23]);
    let before = s.data().to_vec();
    s.mosaic(0, 0, 6, 4, 1);
    assert_eq!(s.data(), before);
}

#[test]
fn stamps_bitmaps_at_integer_scales() {
    let mut s = Surface::new(4, 2);
    s.bits(&Bitmap::parse("#. .#"), 0, 0, 3, 1);
    s.bits(&Bitmap::parse("#"), 2, 0, 5, 2);
    assert_eq!(rows(&s), ["3055", "0355"]);
}

#[test]
fn fills_a_checkerboard_at_50_percent() {
    let mut s = Surface::new(4, 2);
    s.fill_rect(0, 0, 4, 2, 1, dither(8));
    assert_eq!(rows(&s), ["1010", "0101"]);
}

#[test]
fn measures_without_trailing_spacing_proportionally_and_draws_uppercase() {
    let font = BitmapFont::new(&face()).unwrap();
    assert_eq!(font.width("AI", 1), 5);
    assert_eq!(font.width("AI", 2), 10);
    let mut s = Surface::new(6, 3);
    assert_eq!(font.draw(&mut s, "ai", 0, 0, 1, 1), 6);
    assert_eq!(rows(&s), ["010010", "111010", "101010"]);
}

#[test]
fn falls_back_for_missing_glyphs() {
    let font = BitmapFont::new(&face()).unwrap();
    assert_eq!(font.glyph('Z'), font.glyph('?'));
}

#[test]
fn makes_fonts_from_faces_the_first_the_default_unless_one_is_named() {
    let spaced = FontFace { spacing: Some(2), ..face() };
    let fonts = FontRegistry::new(&[("a".into(), face()), ("b".into(), spaced)], None).unwrap();
    assert_eq!(fonts.default_font(), "a");
    assert_eq!(fonts.by_name("b").unwrap().spacing, 2);
    assert!(fonts.by_name("nope").is_none());
    assert_eq!(FontRegistry::new(&[("a".into(), face()), ("b".into(), face())], Some("b")).unwrap().default_font(), "b");
    assert!(FontRegistry::new(&[("a".into(), face())], Some("nope")).is_err());
    assert!(FontRegistry::new(&[], None).is_err());
}

#[test]
fn replays_commands_in_order_each_through_its_clip() {
    let mut list = DrawList::new(fonts());
    list.begin(4, 3, 0);
    list.clip(1, Rect::new(1, 1, 2, 1));
    list.fill(0, 1, Rect::new(0, 0, 4, 3), 1, SOLID);
    list.pixel(0, 0, 3, 2, 2);
    let mut s = Surface::default();
    list.finish(&mut s);
    assert_eq!(rows(&s), ["0000", "0110", "0002"]);
}

#[test]
fn draws_layers_in_order_whenever_their_commands_came() {
    let mut list = DrawList::new(fonts());
    list.begin(2, 1, 0);
    list.fill(1, 0, Rect::new(0, 0, 1, 1), 2, SOLID);
    list.fill(0, 0, Rect::new(0, 0, 2, 1), 1, SOLID);
    let mut s = Surface::default();
    list.finish(&mut s);
    assert_eq!(rows(&s), ["21"]);
}

#[test]
fn ignores_what_it_cant_draw() {
    let mut list = DrawList::new(fonts());
    list.begin(2, 1, 0);
    list.fill(0, 7, Rect::new(0, 0, 2, 1), 1, SOLID);
    list.text(0, 0, 9, "A".into(), 0, 0, 1, 1);
    list.remap(0, 0, Rect::new(0, 0, 2, 1), 3, SOLID);
    let mut s = Surface::default();
    list.finish(&mut s);
    assert_eq!(rows(&s), ["00"]);
}

#[test]
fn draws_text_in_the_fonts_it_names() {
    let mut list = DrawList::new(fonts());
    list.begin(4, 3, 0);
    list.text(0, 0, list.fonts().id("face").unwrap(), "II".into(), 0, 0, 1, 1);
    let mut s = Surface::default();
    list.finish(&mut s);
    assert_eq!(rows(&s), ["1010", "1010", "1010"]);
}

#[test]
fn fades_the_edge_of_a_region_into_a_colour_by_ordered_dither_within_its_clip() {
    // What core resolves `ctx.filter({x: 2, y: 0, w: 6, h: 4}, { to: 0, strength: ramp('right') })`
    // to, in a region clipped to the first 6 columns.
    let mut list = DrawList::new(fonts());
    list.begin(8, 4, 0);
    list.clip(1, Rect::new(0, 0, 6, 4));
    list.fill(0, 0, Rect::new(0, 0, 8, 4), 1, SOLID);
    let to_zero = list.add_map(&[0; 256]);
    let field = StrengthField::Linear { x0: 2.5, y0: 0.5, x1: 7.5, y1: 0.5, start: 0.0, end: 1.0 };
    list.filter(0, 1, Rect::new(2, 0, 6, 4), field, vec![to_zero], Blend::Dither);
    let mut s = Surface::default();
    list.finish(&mut s);
    let r = rows(&s);
    // How many of each column's pixels became 0: none at the start, all at the end, more each step.
    let faded: Vec<usize> = (0..8).map(|x| r.iter().filter(|row| row.as_bytes()[x] == b'0').count()).collect();
    assert_eq!(faded[0..3], [0, 0, 0]);
    assert!(faded[2..6].windows(2).all(|w| w[0] <= w[1]));
    // Past the clip, nothing changes; inside, the fade had reached 4/5 of the way.
    assert_eq!(faded[6..], [0, 0]);
    assert!(faded[5] >= 3);
}
