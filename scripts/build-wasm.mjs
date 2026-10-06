// Builds the web host (crates/backend-web) to WebAssembly and generates its
// JavaScript bindings into packages/backend/pkg, where @synth-ui/backend
// imports them from.
//
// Needs the wasm32-unknown-unknown target (`rustup target add
// wasm32-unknown-unknown`) and wasm-bindgen-cli at exactly the version of
// the wasm-bindgen crate in Cargo.toml (`cargo install wasm-bindgen-cli
// --version <it>`). `--dev` builds unoptimized, with debug info.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
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
