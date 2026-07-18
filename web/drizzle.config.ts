import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// path อ้างอิงจาก cwd ที่รันคำสั่ง (root ของ repo / /app ใน Docker)
export default defineConfig({
  schema: "./web/db/schema.ts",
  out: "./web/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    // path ไฟล์ SQLite (เช่น ./data/pos.db หรือ /data/pos.db ใน Docker)
    url: process.env.DATABASE_URL || "./data/pos.db",
  },
});
