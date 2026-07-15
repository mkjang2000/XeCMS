import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  resolve: {
    alias: [
      {
        find: "@xecms/ui/theme.css",
        replacement: fileURLToPath(new URL("../../packages/ui/src/theme.css", import.meta.url)),
      },
      {
        find: /^@xecms\/ui$/,
        replacement: fileURLToPath(new URL("../../packages/ui/src/index.tsx", import.meta.url)),
      },
      {
        find: /^@xecms\/admin$/,
        replacement: fileURLToPath(new URL("../../packages/admin/src/index.ts", import.meta.url)),
      },
      {
        find: /^@xecms\/client$/,
        replacement: fileURLToPath(new URL("../../packages/client/src/index.ts", import.meta.url)),
      },
      {
        find: /^@xecms\/contracts$/,
        replacement: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)),
      },
      {
        find: /^@xecms\/schema$/,
        replacement: fileURLToPath(new URL("../../packages/schema/src/index.ts", import.meta.url)),
      },
    ],
  },
  server: {
    host: process.env.XECMS_ADMIN_HOST ?? "127.0.0.1",
    port: Number(process.env.XECMS_ADMIN_PORT ?? "5173"),
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.XECMS_SERVER_URL ?? "http://127.0.0.1:3100",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
