import "dotenv/config";
import { seedIfEmpty } from "./seedCore";
import { seedDevDemoData } from "./seedDevDemo";

// CLI: node dist/seed.js (ใช้ใน docker-entrypoint และ npm script)
seedIfEmpty()
  .then(async seeded => {
    if (!seeded) console.log("Base database already seeded, skipping.");
    const demo = await seedDevDemoData();
    if (!demo.skipped) {
      console.log(
        demo.daysCreated > 0
          ? `Dev demo data created: ${demo.daysCreated} days, ${demo.salesCreated} sales.`
          : "Dev demo data already exists, skipping."
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
