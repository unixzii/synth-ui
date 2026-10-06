# @synth-ui/backend

Hosts a [synth-ui](https://github.com/unixzii/synth-ui) interface on a web
page: a canvas, drawn by synth-ui's Rust backend (compiled to WebAssembly)
through WebGPU, or WebGL2 where there's none.

```bash
npm install @synth-ui/core @synth-ui/widgets @synth-ui/backend
```

The package loads its `.wasm` with `new URL(…, import.meta.url)`, which
bundlers such as Vite and webpack 5 pick up and emit on their own.

See the [repository's README](https://github.com/unixzii/synth-ui#readme)
for how to use it.

## License

MIT
