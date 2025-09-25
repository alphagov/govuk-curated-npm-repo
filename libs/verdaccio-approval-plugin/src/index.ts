import {
  IPluginMiddleware,
  IBasicAuth,
  IStorageManager,
  PluginOptions,
  Config,
  Logger,
} from "@verdaccio/types";

import { Application } from "express";
import * as path from "path";
import * as fs from "fs/promises";
import { createQuarantineMiddleware } from "./middleware";
import { PackageScanner } from "./scanner";
import { ApprovalManager } from "./approval-manager";

export interface QuarantineConfig extends Config {
  enabled?: boolean;
  quarantinePath?: string;
  autoscan?: boolean;
  riskThreshold?: number;
}

export class QuarantinePlugin implements IPluginMiddleware<QuarantineConfig> {
  private config: QuarantineConfig;
  private logger: Logger;
  private quarantinePath: string;
  private approvalManager: ApprovalManager;
  private scanner: PackageScanner;

  constructor(
    config: QuarantineConfig,
    options: PluginOptions<QuarantineConfig>,
  ) {
    this.config = config;
    this.logger = options.logger;
    this.quarantinePath =
      this.config.quarantinePath ||
      path.join(options.config.storage || "", "_quarantine");
    this.approvalManager = new ApprovalManager(
      this.quarantinePath,
      this.logger,
    );
    this.scanner = new PackageScanner(this.logger);

    (async () => {
      this.initQuarantine();
    })();
  }

  private async exists(f: string) {
    try {
      await fs.stat(f);
      return true;
    } catch {
      return false;
    }
  }
  private async initQuarantine(): Promise<void> {
    try {
      if (!this.exists(this.quarantinePath)) {
        await fs.mkdir(this.quarantinePath, { recursive: true });
        this.logger.info(
          { plugin: "quarantine" },
          `Quarantine directory intialised: ${this.quarantinePath}`,
        );
      } else {
        this.logger.info(
          { plugin: "quarantine" },
          `Quarantine directory exists: ${this.quarantinePath}`,
        );
      }
    } catch (error) {
      this.logger.error(
        { plugin: "quarantine", error },
        `Failed to initialise quarantine directory: ${this.quarantinePath}`,
      );
    }
  }

  register_middlewares(
    app: Application,
    _auth: IBasicAuth<QuarantineConfig>,
    _storage: IStorageManager<Config>,
  ): void {
    const middleware = createQuarantineMiddleware(
      this.approvalManager,
      this.scanner,
      this.quarantinePath,
      this.logger,
    );

    // Create a sub-app for API routes
    const express = require("express");
    const apiApp = express();

    // Register api routes
    app.use("/-/quarantine", apiApp);

    // Intercept package downloads
    app.use("/:package(*)", middleware.packageInterceptor());

    this.logger.info(
      { plugin: "quarantine" },
      "Quarantine plugin middleware registered",
    );
  }
}

// Plugin factory function
export default function quarantinePlugin(
  config: QuarantineConfig,
  options: PluginOptions<QuarantineConfig>,
): QuarantinePlugin {
  return new QuarantinePlugin(config, options);
}

// Also add CommonJS export for compatibility
module.exports = quarantinePlugin;
module.exports.default = quarantinePlugin;
