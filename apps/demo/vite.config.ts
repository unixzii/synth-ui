import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  // Use the libraries' sources, so edits to them hot-reload without a build.
  resolve: { conditions: ['@synth-ui/source', ...defaultClientConditions] },
});
