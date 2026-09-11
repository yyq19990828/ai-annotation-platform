/**
 * Resolve a stored Markdown image source into a displayable URL.
 *
 * `expiresAt` is an epoch timestamp in milliseconds. Resolvers may omit it
 * for public or otherwise non-expiring URLs.
 */
export type MarkdownImageResolver = (
  src: string,
  options?: { refresh?: boolean },
) => Promise<{ url: string; expiresAt?: number }>;
