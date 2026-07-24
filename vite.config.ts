import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
// โครงโปรเจกต์: โค้ดแอปอยู่ใต้ web/ (UI + API + DB) ส่วน desktop/ เป็น Electron shell
export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, __dirname, "")
  const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/+$/, "")

  return {
    root: "web",
    plugins: [
      devServer({
        entry: "web/api/boot.ts",
        exclude: [/^\/api\/trpc(?:\/|$)/, /^\/(?!api\/).*$/],
      }),
      inspectAttr(),
      react(),
    ],
    server: {
      host: "127.0.0.1",
      port: 3000,
      strictPort: true,
      proxy: supabaseUrl
        ? {
            "/api/trpc": {
              target: supabaseUrl,
              changeOrigin: true,
              secure: true,
              headers: {
                origin: "https://kimi-agent-pos.vercel.app",
              },
              rewrite: requestPath =>
                requestPath.replace(
                  /^\/api\/trpc/,
                  "/functions/v1/pos-api",
                ),
            },
          }
        : undefined,
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
  }
})
