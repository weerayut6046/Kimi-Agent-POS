import devServer from "@hono/vite-dev-server";
import path from "path";
const __dirname = import.meta.dirname;
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { inspectAttr } from "kimi-plugin-inspect-react";

const devAuthenticatedPreloadSource = `
try {
  if (sessionStorage.getItem("pumppos_staff_profile_v1")) {
    void import("/src/AuthenticatedApp.tsx");
    void import("/src/components/Layout.tsx");
    const path = location.pathname;
    if (path === "/") void import("/src/pages/Dashboard.tsx");
    else if (path.startsWith("/pos")) void import("/src/pages/Pos.tsx");
    else if (path.startsWith("/shifts")) void import("/src/pages/Shifts.tsx");
    else if (path.startsWith("/stock")) void import("/src/pages/Stock.tsx");
  }
} catch {}
`;

function authenticatedPreloadPlugin() {
  return {
    name: "pumppos-authenticated-preload",
    enforce: "post" as const,
    configureServer(server: {
      middlewares: {
        use: (
          handler: (
            request: { url?: string },
            response: {
              statusCode: number;
              setHeader: (name: string, value: string) => void;
              end: (body: string) => void;
            },
            next: () => void
          ) => void
        ) => void;
      };
    }) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?", 1)[0] !== "/preload-auth.js") {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(devAuthenticatedPreloadSource);
      });
    },
    transformIndexHtml: {
      order: "post" as const,
      handler() {
        return [
          {
            tag: "script",
            attrs: { src: "/preload-auth.js", defer: true },
            injectTo: "head-prepend" as const,
          },
        ];
      },
    },
    generateBundle(
      this: {
        emitFile: (asset: {
          type: "asset";
          fileName: string;
          source: string;
        }) => void;
      },
      _options: unknown,
      bundle: Record<
        string,
        {
          type: "asset" | "chunk";
          fileName: string;
          facadeModuleId?: string | null;
          viteMetadata?: { importedCss?: Set<string> };
        }
      >
    ) {
      const chunks = Object.values(bundle).filter(
        output => output.type === "chunk"
      );
      const findChunk = (suffix: string) => {
        const normalizedSuffix = suffix.replaceAll("\\", "/");
        const match = chunks.find(output =>
          output.facadeModuleId
            ?.replaceAll("\\", "/")
            .endsWith(normalizedSuffix)
        );
        if (!match) {
          throw new Error(`Unable to find preload chunk for ${suffix}`);
        }
        return `/${match.fileName}`;
      };

      const authenticatedApp = chunks.find(output =>
        output.facadeModuleId
          ?.replaceAll("\\", "/")
          .endsWith("/web/src/AuthenticatedApp.tsx")
      );
      if (!authenticatedApp) {
        throw new Error("Unable to find authenticated application chunk");
      }

      const authenticatedCss = [
        ...(authenticatedApp.viteMetadata?.importedCss ?? []),
      ].map(fileName => `/${fileName}`);
      const paths = {
        authenticatedApp: `/${authenticatedApp.fileName}`,
        layout: findChunk("/web/src/components/Layout.tsx"),
        dashboard: findChunk("/web/src/pages/Dashboard.tsx"),
        pos: findChunk("/web/src/pages/Pos.tsx"),
        shifts: findChunk("/web/src/pages/Shifts.tsx"),
        stock: findChunk("/web/src/pages/Stock.tsx"),
      };
      const source = `
try {
  if (sessionStorage.getItem("pumppos_staff_profile_v1")) {
    for (const href of ${JSON.stringify(authenticatedCss)}) {
      if (!document.querySelector('link[rel="stylesheet"][href="' + href + '"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        document.head.append(link);
      }
    }
    void import(${JSON.stringify(paths.authenticatedApp)});
    void import(${JSON.stringify(paths.layout)});
    const path = location.pathname;
    if (path === "/") void import(${JSON.stringify(paths.dashboard)});
    else if (path.startsWith("/pos")) void import(${JSON.stringify(paths.pos)});
    else if (path.startsWith("/shifts")) void import(${JSON.stringify(paths.shifts)});
    else if (path.startsWith("/stock")) void import(${JSON.stringify(paths.stock)});
  }
} catch {}
`;
      this.emitFile({
        type: "asset",
        fileName: "preload-auth.js",
        source,
      });
    },
  };
}

// https://vite.dev/config/
// โครงโปรเจกต์: โค้ดแอปอยู่ใต้ web/ (UI + API + DB) ส่วน desktop/ เป็น Electron shell
export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, __dirname, "");
  const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/+$/, "");
  const proxyTrpcToSupabase =
    viteEnv.VITE_USE_SUPABASE_EDGE_API?.trim().toLowerCase() === "true" &&
    Boolean(supabaseUrl);

  if (!proxyTrpcToSupabase) {
    // env ทั้งโปรเจกต์อยู่ใน `.env` ไฟล์เดียว — Vite โหลด VITE_* ให้ browser
    // ส่วน dotenv/config ใน local Hono entry อ่านไฟล์เดียวกัน ส่งต่อค่า
    // public Supabase เดียวกันให้ local API verify JWT ที่ browser ได้รับ
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
      authenticatedPreloadPlugin(),
    ],
    server: {
      // ค่าเริ่มต้นผูกเฉพาะ loopback — เปิดขายหลายเครื่องใน LAN ให้รัน npm run dev:lan
      // (ตั้ง BIND_HOST=0.0.0.0) ส่วน production bind 0.0.0.0 อยู่แล้วที่ web/api/boot.ts
      host: viteEnv.BIND_HOST || "127.0.0.1",
      port: Number(viteEnv.APP_PORT || viteEnv.PORT || 3000),
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
