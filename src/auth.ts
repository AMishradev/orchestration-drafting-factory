import { timingSafeEqual } from "node:crypto";

export function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length);
}

export function tokenMatches(
  supplied: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return true;
  if (!supplied) return false;
  const suppliedBytes = new TextEncoder().encode(supplied);
  const expectedBytes = new TextEncoder().encode(expected);
  return (
    suppliedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export async function readSecret(
  directValue: string | undefined,
  filePath: string | undefined,
): Promise<string | undefined> {
  if (directValue) return directValue;
  if (!filePath) return undefined;
  const value = (await Bun.file(filePath).text()).trim();
  return value || undefined;
}
