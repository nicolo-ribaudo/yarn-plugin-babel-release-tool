export const IGNORE = (file: string) =>
  /\.(?:md|txt)$/i.test(file) ||
  /\/test\//i.test(file) ||
  /\/codemods\//i.test(file) ||
  /(?<!native-modules|built-ins|plugins|package)\.json$/.test(file);
