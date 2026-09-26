/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Canal de publication défini au build (« beta » pour une pré-version, sinon absent) */
  readonly VITE_RELEASE_CHANNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
