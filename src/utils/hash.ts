/** Simple browser-safe hash for import fingerprints (not crypto-secure). */
export function createHash(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i)
  }
  // unsigned + pad
  return (h >>> 0).toString(16).padStart(8, '0') + input.length.toString(16)
}
