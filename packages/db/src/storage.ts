import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { ERROR_HTTP_STATUS, type ErrorCode } from '@sb/contracts';
export const DEFAULT_DATABASE_URL = 'postgres://sb:sb@127.0.0.1:54329/sb';
export function createPool(connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  return new Pool({ connectionString, max: 20 });
}
export const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export class DomainError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message = code as string,
    readonly details: Record<string, unknown> = {},
    readonly commit = false,
  ) {
    super(message);
    this.status = ERROR_HTTP_STATUS[code];
  }
}
export function fail(
  code: ErrorCode,
  details: Record<string, unknown> = {},
  commit = false,
): never {
  throw new DomainError(code, messages[code] ?? '요청을 처리할 수 없습니다.', details, commit);
}
const messages: Partial<Record<ErrorCode, string>> = {
  NOT_FOUND: '접근할 수 없는 정보입니다.',
  SESSION_EXPIRED: '데모 아이디로 다시 들어와 주세요.',
  CSRF_REJECTED: '페이지를 새로 확인해 주세요.',
  VERSION_CONFLICT: '조건이 변경됐어요. 최신 제안을 확인해 주세요.',
  QUOTE_EXPIRED: '가격을 다시 확인해 주세요.',
  OFFER_EXPIRED: '제안의 유효 시간이 지났습니다.',
  REQUEST_EXPIRED: '요청의 유효 시간이 지났습니다.',
  AVAILABILITY_CONFLICT: '다른 요청에서 물품을 선택했습니다.',
  INVALID_STATE: '현재 상태에서는 실행할 수 없습니다.',
  PRICE_OUT_OF_RANGE: '허용된 금액 범위와 500원 단위를 확인해 주세요.',
};
export async function read<T>(c: Pool | PoolClient, table: string, key: string): Promise<T | null> {
  const r = await c.query(`SELECT data FROM ${table} WHERE id=$1`, [key]);
  return (r.rows[0]?.data as T) ?? null;
}
export async function put(
  c: PoolClient,
  table: string,
  data: { id: string },
  insert = false,
): Promise<void> {
  await c.query(
    insert
      ? `INSERT INTO ${table}(id,data) VALUES($1,$2)`
      : `UPDATE ${table} SET data=$2 WHERE id=$1`,
    [data.id, data],
  );
}
export async function all<T>(
  c: Pool | PoolClient,
  table: string,
  where = '',
  args: unknown[] = [],
): Promise<T[]> {
  const r = await c.query(`SELECT data FROM ${table} ${where}`, args);
  return r.rows.map((row) => row.data as T);
}
