export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:4000';

export const API_BASE = `${SERVER_URL}/api`;
