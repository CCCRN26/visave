// const { loadEnvConfig } = require("@next/env");

// loadEnvConfig(process.cwd());
// const { loadEnvConfig } = require("@next/env");

// loadEnvConfig(process.cwd());

// const { Pool } = require("pg");

// if (!process.env.DATABASE_URL) {
//   throw new Error("DATABASE_URL is missing from environment variables");
// }

// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,
// });
// import fs from "node:fs/promises"; import path from "node:path"; import pg from "pg";
// const {Client}=pg; const client=new Client({connectionString:process.env.DATABASE_URL});
// try { await client.connect(); await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"); const dir=path.join(process.cwd(),"database","migrations"); for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith(".sql")).sort()){ const exists=await client.query("SELECT 1 FROM schema_migrations WHERE filename=$1",[file]); if(exists.rowCount) continue; await client.query("BEGIN"); try { await client.query(await fs.readFile(path.join(dir,file),"utf8")); await client.query("INSERT INTO schema_migrations(filename) VALUES($1)",[file]); await client.query("COMMIT"); console.log(`Applied ${file}`); } catch(e){await client.query("ROLLBACK");throw e;} } } finally {await client.end();}
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const { Client } = pg;

// Load .env / .env.local from the project root
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Check your .env file in the project root."
  );
}

// Safe debugging: prints username/database but NOT password
const dbUrl = new URL(process.env.DATABASE_URL);

console.log("Database environment loaded.");
console.log("PostgreSQL user:", dbUrl.username);
console.log("PostgreSQL host:", dbUrl.hostname);
console.log("PostgreSQL database:", dbUrl.pathname.replace("/", ""));

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

try {
  await client.connect();

  console.log("Connected to PostgreSQL.");

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.join(
    process.cwd(),
    "database",
    "migrations"
  );

  const through = process.env.MIGRATION_THROUGH?.trim();
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => !through || Number.parseInt(file.slice(0, 3), 10) <= Number.parseInt(through.slice(0, 3), 10))
    .sort();

  for (const file of files) {
    const exists = await client.query(
      `
        SELECT 1
        FROM schema_migrations
        WHERE filename = $1
      `,
      [file]
    );

    if (exists.rowCount > 0) {
      console.log(`Skipped ${file} (already applied)`);
      continue;
    }

    await client.query("BEGIN");

    try {
      const sql = await fs.readFile(
        path.join(migrationsDir, file),
        "utf8"
      );

      await client.query(sql);

      await client.query(
        `
          INSERT INTO schema_migrations (filename)
          VALUES ($1)
        `,
        [file]
      );

      await client.query("COMMIT");

      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  console.log("All migrations completed successfully.");
} catch (error) {
  console.error("Migration failed:");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
