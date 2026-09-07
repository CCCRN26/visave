import { pool } from "./pool.js";
export async function runTransaction(dbPool, work) {
  const client = await dbPool.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function withTransaction(work) { return runTransaction(pool, work); }
