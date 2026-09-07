// import fs from "node:fs/promises"; import path from "node:path"; import pg from "pg"; import bcrypt from "bcryptjs";
// const {Client}=pg; const client=new Client({connectionString:process.env.DATABASE_URL});
// try { await client.connect(); await client.query("BEGIN"); for(const file of (await fs.readdir(path.join(process.cwd(),"database","seeds"))).filter(f=>f.endsWith(".sql")).sort()) await client.query(await fs.readFile(path.join(process.cwd(),"database","seeds",file),"utf8")); const email=process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase(), password=process.env.SEED_ADMIN_PASSWORD; if(email&&password){if(password.length<12) throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters"); const hash=await bcrypt.hash(password,12); await client.query(`INSERT INTO users(organization_id,first_name,last_name,email,password_hash,status,must_change_password) SELECT id,'System','Administrator',$1,$2,'ACTIVE',false FROM organizations WHERE code='CCCRN' ON CONFLICT DO NOTHING`,[email,hash]); await client.query(`INSERT INTO user_roles(user_id,role_id) SELECT u.id,r.id FROM users u JOIN roles r ON r.code='SUPER_ADMIN' WHERE lower(u.email)=$1 ON CONFLICT DO NOTHING`,[email]);} else console.warn("Admin not seeded: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD"); await client.query("COMMIT"); console.log("Seed complete"); } catch(e){await client.query("ROLLBACK");throw e;} finally{await client.end();}

import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const { Client } = pg;

// Load .env / .env.local
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Check the .env file in the project root."
  );
}

// Safe connection debugging - does NOT print password
const dbUrl = new URL(process.env.DATABASE_URL);

console.log("Database environment loaded.");
console.log("PostgreSQL user:", dbUrl.username);
console.log("PostgreSQL host:", dbUrl.hostname);
console.log(
  "PostgreSQL database:",
  dbUrl.pathname.replace("/", "")
);

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

let transactionStarted = false;

try {
  console.log("Connecting to PostgreSQL...");

  await client.connect();

  console.log("Connected to PostgreSQL.");

  await client.query("BEGIN");
  transactionStarted = true;

  const seedsDirectory = path.join(
    process.cwd(),
    "database",
    "seeds"
  );

  const files = (await fs.readdir(seedsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    console.log(`Running seed: ${file}`);

    const sql = await fs.readFile(
      path.join(seedsDirectory, file),
      "utf8"
    );

    await client.query(sql);

    console.log(`Completed seed: ${file}`);
  }

  const email = process.env.SEED_ADMIN_EMAIL
    ?.trim()
    .toLowerCase();

  const password = process.env.SEED_ADMIN_PASSWORD;

  if (email && password) {
    if (password.length < 12) {
      throw new Error(
        "SEED_ADMIN_PASSWORD must be at least 12 characters."
      );
    }

    console.log("Creating/updating development Super Admin...");

    const hash = await bcrypt.hash(password, 12);

    await client.query(
      `
        INSERT INTO users (
          organization_id,
          first_name,
          last_name,
          email,
          password_hash,
          status,
          must_change_password
        )
        SELECT
          id,
          'System',
          'Administrator',
          $1,
          $2,
          'ACTIVE',
          false
        FROM organizations
        WHERE code = 'CCCRN'
        ON CONFLICT DO NOTHING
      `,
      [email, hash]
    );

    await client.query(
      `
        INSERT INTO user_roles (
          user_id,
          role_id
        )
        SELECT
          u.id,
          r.id
        FROM users u
        JOIN roles r
          ON r.code = 'SUPER_ADMIN'
        WHERE LOWER(u.email) = $1
        ON CONFLICT DO NOTHING
      `,
      [email]
    );

    console.log("Super Admin seed completed.");
  } else {
    console.warn(
      "Admin not seeded: set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env"
    );
  }

  await client.query("COMMIT");
  transactionStarted = false;

  console.log("Seed complete.");
} catch (error) {
  console.error("\nSeed failed.");

  if (transactionStarted) {
    try {
      await client.query("ROLLBACK");
      console.log("Seed transaction rolled back.");
    } catch (rollbackError) {
      console.error(
        "Rollback could not be completed:",
        rollbackError.message
      );
    }
  }

  console.error(error);

  process.exitCode = 1;
} finally {
  try {
    await client.end();
  } catch {
    // Connection may already have been terminated.
  }
}