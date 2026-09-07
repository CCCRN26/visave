import pg from "pg";
import nextEnv from "@next/env";
import { databaseUrlFor, requireDisposableDatabaseName } from "./lib/disposable-database.js";

const { loadEnvConfig } = nextEnv;
const { Client } = pg;
loadEnvConfig(process.cwd());

const target = requireDisposableDatabaseName(process.argv[3]);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const source = new URL(process.env.DATABASE_URL);
if (source.pathname.slice(1) === target) throw new Error("Run database URL must not already target the administrative connection");
const admin = new URL(source); admin.pathname = "/postgres";
const client = new Client({ connectionString: admin.toString() });
await client.connect();
try {
  const action = process.argv[2] || "create";
  console.log(`Disposable database target: ${target}`);
  if (action === "recreate") {
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [target]);
    await client.query(`DROP DATABASE IF EXISTS ${target}`);
  }
  if (!["create", "recreate"].includes(action)) throw new Error("Expected create or recreate");
  const exists = (await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [target])).rowCount;
  if (!exists) await client.query(`CREATE DATABASE ${target}`);
  const acceptance = databaseUrlFor(source, target);
  console.log(JSON.stringify({ database: target, created: !exists || action === "recreate", connection: `${acceptance.hostname}:${acceptance.port || "5432"}/${target}` }));
} finally { await client.end(); }
