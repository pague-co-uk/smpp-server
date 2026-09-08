import { isIP } from "node:net";

export function normalizeIpAddress(
  address: string | undefined,
): string | undefined {
  if (!address) {
    return undefined;
  }

  const normalized = address.trim();

  if (isIP(normalized) === 4) {
    return normalized;
  }

  if (
    isIP(normalized) === 6 &&
    normalized.toLowerCase().startsWith("::ffff:")
  ) {
    const ipv4 = normalized.slice(7);

    return isIP(ipv4) === 4
      ? ipv4
      : normalized;
  }

  return normalized;
}