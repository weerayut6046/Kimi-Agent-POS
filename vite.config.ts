import devServer from "@hono/vite-dev-server";
import path from "path";
const __dirname = import.meta.dirname;
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { inspectAttr } from "kimi-plugin-inspect-react";

// https://vite.dev/config/
// โครงโปรเจกต์: โค้ดแอปอยู่ใต้ web/ (UI + API + DB) ส่วน desktop/ เป็น Electron shell
export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, __dirname, "");
  const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/+$/, "");
  const proxyTrpcToSupabase =
    viteEnv.VITE_USE_SUPABASE_EDGE_API?.trim().toLowerCase() === "true" &&
    Boolean(supabaseUrl);

  if (!proxyTrpcToSupabase) {
    // Vite loads .env.local for the browser, while dotenv/config in the local
    // Hono entry only loads .env. Reuse the same public Supabase values so the
    // local API can verify the JWT issued to the browser.
    process.env.SUPABASE_URL ||= viteEnv.VITE_SUPABASE_URL;
    process.env.SUPABASE_PUBLISHABLE_KEY ||=
      viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
  }

  return {
    root: "web",
    plugins: [
      devServer({
        entry: "web/api/boot.ts",
        exclude: [
          ...(proxyTrpcToSupabase ? [/^\/api\/trpc(?:\/|$)/] : []),
          /^\/(?!api\/).*$/,
        ],
      }),
      ...(mode === "development" ? [inspectAttr()] : []),
      react(),
    ],
    server: {
      host: "127.0.0.1",
      port: 3000,
      strictPort: true,
      proxy: proxyTrpcToSupabase
        ? {
            "/api/trpc": {
              target: supabaseUrl!,
              changeOrigin: true,
              secure: true,
              headers: {
                origin: "https://kimi-agent-pos.vercel.app",
              },
              rewrite: requestPath =>
                requestPath.replace(/^\/api\/trpc/, "/functions/v1/pos-api"),
            },
          }
        : undefined,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./web/src"),
        "@contracts": path.resolve(__dirname, "./web/contracts"),
        "@db": path.resolve(__dirname, "./web/db"),
        db: path.resolve(__dirname, "./web/db"),
      },
    },
    envDir: path.resolve(__dirname),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
    },
  };
});
