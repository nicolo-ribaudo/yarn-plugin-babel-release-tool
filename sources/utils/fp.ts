export function compareBy(prop) {
  return (a, b) => (a[prop] < b[prop] ? -1 : a[prop] > b[prop] ? 1 : 0);
}

export function asyncMap<T, U>(
  array: T[],
  callback: (value: T) => Promise<U>
): Promise<U[]> {
  return Promise.all(array.map(callback));
}
