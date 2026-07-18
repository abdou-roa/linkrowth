/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly LINKROWTH_API_URL?: string;
  readonly LINKROWTH_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
