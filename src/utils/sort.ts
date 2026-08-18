import { Timestamp } from 'firebase/firestore'

export function millisOf(value: Timestamp | null | undefined): number {
  return value?.toMillis?.() ?? 0
}

export function sortByNewest<T>(
  items: T[],
  getTimestamp: (item: T) => Timestamp | null | undefined,
): T[] {
  return [...items].sort((a, b) => millisOf(getTimestamp(b)) - millisOf(getTimestamp(a)))
}
