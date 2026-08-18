// FROZEN CONFIG — this file is identical across every checkpoint.
// `npm run catchup N` never touches it. Please don't edit it during the workshop.
//
// Plugin order matters: flue() must come BEFORE cloudflare(), and cloudflare()
// needs Flue's Worker-config customizer so it picks up the generated Worker
// entry and per-agent Durable Object bindings.
import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [flue(), cloudflare({ config: flueWorkerConfig() })],
});
