declare global {
  namespace App {}
  /** Injected at build time from addon/config.yaml's `version:` field. */
  const __COSMOS_VERSION__: string;
}
export {};
