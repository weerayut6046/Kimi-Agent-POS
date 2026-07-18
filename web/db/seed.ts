import { seedIfEmpty } from "./seedCore";

// CLI: node dist/seed.js (ใช้ใน docker-entrypoint และ npm script)
seedIfEmpty()
  .then((seeded) => {
    if (!seeded) console.log("Database already seeded, skipping.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
