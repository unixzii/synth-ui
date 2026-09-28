// Pixel icons, 1-bit: drawn in whatever colour the widget holding them says.

import { bitmap } from '@synth-ui/core';

export const ICONS = {
  play: bitmap('#.... ##... ###.. ####. ###.. ##... #....'),
  pause: bitmap('##.## ##.## ##.## ##.## ##.## ##.## ##.##'),
  loop: bitmap('.....#... #######.. #....#... #.......# ...#....# ..####### ...#.....'),
  crt: bitmap('..#...#.. ...#.#... ######### #.......# #.#####.# #.......# #########'),
  menu: bitmap('####### ....... ####### ....... #######'),
  close: bitmap('#.....# .#...#. ..#.#.. ...#... ..#.#.. .#...#. #.....#'),
  plus: bitmap('..#.. ..#.. ##### ..#.. ..#..'),
  minus: bitmap('..... ..... ##### ..... .....'),
  left: bitmap('..# .## ### .## ..#'),
  right: bitmap('#.. ##. ### ##. #..'),
  up: bitmap('..#.. .###. #####'),
  down: bitmap('##### .###. ..#..'),
  check: bitmap('....# ...## #.##. ###.. .#...'),
};
