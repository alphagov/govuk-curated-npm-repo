import * as path from "path";
import * as fs from "fs/promises";
import { Logger } from "@verdaccio/types";
import { ScanResults } from "./scanner";

export type ApprovalStatus = "pending" | "approved" | "blocked" | "rejected";

export interface PackageRecord {
  status: ApprovalStatus;
  requestedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  riskScore?: number;
  scanResults?: ScanResults | undefined;
  scannedAt?: string | undefined;
  requestedBy?: string | undefined;
}

export interface ApprovalDatabase {
  packages: Record<string, PackageRecord>;
  version: number;
}

export interface BlockedAttempt {
  package: string;
  ip: string;
  timestamp: string;
  userAgent?: string;
}

export interface BlockedAttemptsLog {
  attempts: BlockedAttempt[];
}

export interface PackageRequest extends PackageRecord {
  package: string;
}

export class ApprovalManager {
  private quarantinePath: string;
  private dbPath: string;
  private logPath: string;
  private logger: Logger;

  constructor(quarantinePath: string, logger: Logger) {
    this.quarantinePath = quarantinePath;
    this.dbPath = path.join(this.quarantinePath, "approvals.json");
    this.logPath = path.join(this.quarantinePath, "blocked-attempts.json");
    this.logger = logger;
  }

  private async loadDb(): Promise<ApprovalDatabase> {
    try {
      const data = await fs.readFile(this.dbPath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, return empty db
      return { packages: {}, version: 1 };
    }
  }

  private async saveDb(db: ApprovalDatabase): Promise<void> {
    await fs.writeFile(this.dbPath, JSON.stringify(db, null, 2));
  }

  async getApprovalStatus(packageName: string): Promise<ApprovalStatus> {
    const db = await this.loadDb();
    const pkg = db.packages[packageName];

    if (!pkg) {
      // Package not yet requested - record the request
      await this.recordPackageRequest(packageName);
      return "blocked";
    }

    return pkg.status;
  }

  async recordPackageRequest(
    packageName: string,
    requestedBy?: string,
  ): Promise<void> {
    const db = await this.loadDb();
    if (db.packages[packageName]) {
      return; //Already exists
    }

    db.packages[packageName] = {
      status: "pending",
      requestedAt: new Date().toISOString(),
      requestedBy,
      riskScore: 0,
      scanResults: undefined,
    };

    await this.saveDb(db);
    this.logger.info(
      { plugin: "quarantine", package: packageName },
      "New package request recorded",
    );
  }

  async approvePackage(packageName: string): Promise<void> {
    const db = await this.loadDb();

    if (!db.packages[packageName]) {
      throw new Error("Package not found in approval database");
    }

    db.packages[packageName].status = "approved";
    db.packages[packageName].approvedAt = new Date().toISOString();

    await this.saveDb(db);
  }

  async rejectPackage(packageName: string): Promise<void> {
    const db = await this.loadDb();

    if (!db.packages[packageName]) {
      throw new Error("Package not found in approval database");
    }

    db.packages[packageName].status = "rejected";
    db.packages[packageName].rejectedAt = new Date().toISOString();

    await this.saveDb(db);
  }

  async updateScanResults(
    packageName: string,
    scanResults: ScanResults,
  ): Promise<void> {
    const db = await this.loadDb();

    if (!db.packages[packageName]) {
      throw new Error("Package not found in approval database");
    }

    db.packages[packageName].scanResults = scanResults;
    db.packages[packageName].riskScore = scanResults.riskScore;
    db.packages[packageName].scannedAt = scanResults.scannedAt;

    await this.saveDb(db);
  }

  async logBlockedAttempt(
    packageName: string,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    try {
      const logs = await this.loadBlockedAttempts();

      logs.attempts.push({
        package: packageName,
        ip,
        timestamp: new Date().toISOString(),
        userAgent,
      });

      // Keep only last 1000 attempts
      if (logs.attempts.length > 1000) {
        logs.attempts = logs.attempts.slice(-1000);
      }

      await fs.writeFile(this.logPath, JSON.stringify(logs, null, 2));
    } catch (error) {
      this.logger.error(
        { plugin: "quarantine", error },
        "Failed to log blocked attempt",
      );
    }
  }

  async loadBlockedAttempts(): Promise<BlockedAttemptsLog> {
    try {
      const data = await fs.readFile(this.logPath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      return { attempts: [] };
    }
  }

  async getBlockedAttempts(): Promise<BlockedAttempt[]> {
    const logs = await this.loadBlockedAttempts();
    return logs.attempts;
  }

  async getAllRequests(): Promise<PackageRequest[]> {
    const db = await this.loadDb();
    return Object.entries(db.packages).map(([name, data]) => ({
      package: name,
      ...data,
    }));
  }

  async getRiskAssessment(packageName: string): Promise<{
    package: string;
    riskScore?: number;
    scanResults?: ScanResults;
    scannedAt?: string | undefined;
  }> {
    const db = await this.loadDb();
    const pkg = db.packages[packageName];

    if (!pkg || !pkg.scanResults) {
      throw new Error("Risk assessment not available");
    }

    return {
      package: packageName,
      riskScore: pkg.riskScore || 0,
      scanResults: pkg.scanResults,
      scannedAt: pkg.scannedAt,
    };
  }
}
