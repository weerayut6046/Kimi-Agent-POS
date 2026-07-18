import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
// โครงโปรเจกต์: โค้ดแอปอยู่ใต้ web/ (UI + API + DB) ส่วน desktop/ เป็น Electron shell
export default defineConfig({
  root: "web",
  plugins: [
    devServer({ entry: "web/api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./web/src"),
      "@contracts": path.resolve(__dirname, "./web/contracts"),
      "@db": path.resolve(__dirname, "./web/db"),
      "db": path.resolve(__dirname, "./web/db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
