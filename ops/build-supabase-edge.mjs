import { build } from "esbuild";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const entry = path.join(root, "web/api/edgeRuntime.ts");
const outfile = path.join(
  root,
  "supabase/functions/pos-api/app.bundle.ts",
);
const maxApiBundleBytes = 5 * 1024 * 1024;

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // The lightweight request wrapper loads this module only for business
  // routes. Keep runtime-native npm packages external so Supabase can use
  // their Deno-compatible implementations without esbuild's Node shims.
  external: [
    "jsr:*",
    "node:*",
    "@supabase/supabase-js",
    "@trpc/server",
    "@trpc/server/*",
    "crypto",
    "drizzle-orm",
    "drizzle-orm/*",
    "os",
    "postgres",
    "superjson",
    "zod",
  ],
  plugins: [
    {
      name: "supabase-edge-excel-export",
      setup(buildContext) {
        buildContext.onResolve(
          { filter: /^\.\.\/lib\/excelExport$/ },
          () => ({
            path: path.join(root, "web/api/lib/excelExport.edge.ts"),
          }),
        );
      },
    },
  ],
  minify: true,
  sourcemap: false,
  legalComments: "none",
});

const result = await stat(outfile);
if (result.size > maxApiBundleBytes) {
  throw new Error(
    `Supabase Edge bundle is ${result.size} bytes; API deployment limit is ${maxApiBundleBytes} bytes`,
  );
}
console.log(
  `Supabase Edge bundle ready: ${path.relative(root, outfile)} (${result.size} bytes)`,
);
