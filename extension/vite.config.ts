import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [crx({ manifest })],
  server: {
    // porta fixa: o service worker do MV3 em dev precisa de HMR num endereço estável
    port: 5173,
    strictPort: true,
  },
});
