import pg from "pg";

const { Pool } = pg;
const key = Symbol.for("cccrn.vsla.pg.pool");

function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
}

export const pool = globalThis[key] || createPool();
if (process.env.NODE_ENV !== "production") globalThis[key] = pool;
