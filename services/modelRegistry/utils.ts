export const normalizeBaseUrl = (url: string): string => 
  url.trim().replace(/\/+$/, '').toLowerCase();