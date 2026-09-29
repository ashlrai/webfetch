/**
 * Default User-Agent for outbound requests.
 *
 * Wikimedia (https://meta.wikimedia.org/wiki/User-Agent_policy) and MusicBrainz
 * require a UA that identifies the client and includes contact info. Wikimedia
 * answers generic UAs such as "webfetch-mcp/0.1" with HTTP 429, which silently
 * removed the #1 default provider from results. Override the UA with
 * WEBFETCH_USER_AGENT, or pass auth.userAgent / opts.userAgent per call.
 */
export const DEFAULT_USER_AGENT = "webfetch/0.1 (+https://github.com/ashlrai/webfetch)";

export function defaultUserAgent(env: Record<string, string | undefined> = process.env): string {
  return env.WEBFETCH_USER_AGENT || DEFAULT_USER_AGENT;
}
