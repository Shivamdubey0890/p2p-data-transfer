/**
 * Signaling server base URL. When unset, defaults to the page's own origin —
 * used when the server serves the built client (single-service deployment).
 */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? window.location.origin;

export const API_BASE = `${SERVER_URL}/api`;
