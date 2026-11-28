import pg from "pg";
import { config } from "./config.js";

// bigint / numeric come back as strings by default; ids and money fit safely in JS numbers here.
pg.types.setTypeParser(20, (v) => Number(v));      // int8
pg.types.setTypeParser(1700, (v) => Number(v));    // numeric
pg.types.setTypeParser(1082, (v) => v);            // date -> 'YYYY-MM-DD' (no timezone shifting)

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 15 });
pool.on("error", (e) => console.error("[pg] idle client error", e));

export type Db = Pick<pg.Pool, "query"> | pg.PoolClient;

/** snake_case -> camelCase for response bodies (only plain lowercase_snake keys, so JSON content like "07:30_AM" is untouched). */
export function camelize<T = any>(value: any): T {
  if (Array.isArray(value)) return value.map(camelize) as any;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      const key = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(k) ? k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()) : k;
      out[key] = camelize(v);
    }
    return out as T;
  }
  return value;
}

export async function q<T = any>(text: string, params: any[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(text, params);
  return r.rows as T[];
}
export async function one<T = any>(text: string, params: any[] = [], db: Db = pool): Promise<T | null> {
  return (await q<T>(text, params, db))[0] ?? null;
}

/** Run `fn` inside a transaction (BEGIN … COMMIT / ROLLBACK). */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Build a dynamic `SET a=$1, b=$2` clause from the defined keys of `fields` (column names must be trusted constants). */
export function setClause(fields: Record<string, any>, startAt = 1) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  return {
    sql: keys.map((k, i) => `${k} = $${startAt + i}`).join(", "),
    values: keys.map((k) => fields[k]),
    empty: keys.length === 0,
  };
}
