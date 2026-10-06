// Builds the web host (crates/backend-web) to WebAssembly and generates its
// JavaScript bindings into packages/backend/pkg, where @synth-ui/backend
// imports them from.
//
// Needs the wasm32-unknown-unknown target (`rustup target add
// wasm32-unknown-unknown`) and wasm-bindgen-cli at exactly the version of
// the wasm-bindgen crate in Cargo.toml (`cargo install wasm-bindgen-cli
// --version <it>`). `--opt` puts the result through wasm-opt (binaryen,
// from npm), which also drops the function names: for what ships. `--dev`
// builds unoptimized, with debug info.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const opt = !dev && process.argv.includes('--opt');
const profile = dev ? 'debug' : 'release';
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

const wanted = readFileSync(join(root, 'Cargo.toml'), 'utf8').match(/^wasm-bindgen\s*=\s*"=([^"]+)"/m)?.[1];
let installed = '';
try {
  installed = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim().split(/\s+/)[1];
} catch {
  // Not installed: said below.
}
if (installed !== wanted) {
  console.error(`build-wasm: needs wasm-bindgen-cli ${wanted} (found ${installed || 'none'}): cargo install wasm-bindgen-cli --version ${wanted}`);
  process.exit(1);
}

run('cargo', ['build', '-p', 'synth-backend-web', '--target', 'wasm32-unknown-unknown', ...(dev ? [] : ['--release'])]);
run('wasm-bindgen', [
  '--target',
  'web',
  '--out-dir',
  'packages/backend/pkg',
  ...(dev ? ['--debug', '--keep-debug'] : []),
  `target/wasm32-unknown-unknown/${profile}/synth_backend_web.wasm`,
]);
if (opt) {
  // Features come from the module's target_features section.
  const wasmOpt = createRequire(import.meta.url).resolve('binaryen/bin/wasm-opt');
  const out = 'packages/backend/pkg/synth_backend_web_bg.wasm';
  run(process.execPath, [wasmOpt, '-Oz', out, '-o', out]);
}
