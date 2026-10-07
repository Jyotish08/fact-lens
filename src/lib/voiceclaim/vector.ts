export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let left = 0;
  let right = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index]! * b[index]!;
    left += a[index]! ** 2;
    right += b[index]! ** 2;
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}
