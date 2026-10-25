/** Native cookie-authenticated requests must satisfy the server's trusted-origin
 * checks. Use the actual configured API destination, never a caller override. */
export function requestOrigin(url: string): string {
  return new URL(url).origin;
}
