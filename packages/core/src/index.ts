export interface FrameworkConfig {
  /** The port used by the development server. */
  port?: number;
}

/** Preserve and type-check a framework configuration object. */
export function defineConfig<T extends FrameworkConfig>(config: T): T {
  return config;
}
