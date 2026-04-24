export function createCanary(prefix = "CANARY"): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${suffix}`;
}
