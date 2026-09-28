import type { Identity } from "./auth";

export interface AppEnv {
  Bindings: Env;
  Variables: { identity: Identity };
}
