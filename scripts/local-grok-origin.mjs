// Pure validation: no environment reads, credentials, or process startup.
export function localGrokOrigin(args) {
  if (args.length === 0) return 'http://127.0.0.1:3002';
  if (args.length !== 1) throw new Error('Expected at most one public origin');
  const value = args[0];
  // Match the literal input before URL normalization can discard paths,
  // whitespace, credentials, or encoded hostname characters.
  if (typeof value !== 'string'
    || !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\.devtunnels\.ms\/?$/.test(value)) {
    throw new Error('Expected an exact HTTPS dev tunnel origin');
  }
  return new URL(value).origin;
}
