import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  // path ไฟล์ SQLite (Electron ตั้งเป็น userData/pos.db, Docker ตั้งเป็น /data/pos.db)
  databaseUrl: process.env.DATABASE_URL || "./data/pos.db",
};
