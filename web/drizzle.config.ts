import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DIRECT_URL or DATABASE_URL is required for PostgreSQL migrations");
}

export default defineConfig({
  schema: "./web/db/schema.ts",
  out: "./web/db/migrations-postgres",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
