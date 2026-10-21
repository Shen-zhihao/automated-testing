export interface RefreshQueue {
  request(): Promise<void>;
  dispose(): void;
}
export function createRefreshQueue<T>(
  load: () => Promise<T>,
  accept: (value: T) => void,
  fail?: (error: unknown) => void,
): RefreshQueue;
