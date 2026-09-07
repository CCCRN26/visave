import { pool } from "./pool.js";
export async function query(text, params = []) { return (await pool.query(text, params)).rows; }
