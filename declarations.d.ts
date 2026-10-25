// Type declarations for non-module imports
declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.svg' {
  const value: string;
  export default value;
}

// Electron preload bridge (see electron/preload.cjs)
interface Window {
  mangaStudioBridge?: {
    exportLegacy(
      data: unknown,
      password: string
    ): Promise<{ ok: boolean; path?: string; reason?: string }>;
  };
}
