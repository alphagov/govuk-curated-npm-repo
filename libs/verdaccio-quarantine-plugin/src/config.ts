import { Config as VerdaccioConfig } from "@verdaccio/types";

export interface QuarantineConfig {
  quarantinePath: string;
  storagePath: string;
  approvalListPath?: string;
}

export interface PluginConfig extends QuarantineConfig, VerdaccioConfig {}
