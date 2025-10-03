import * as fs from "node:fs";
import * as path from "path";
import { PackageVersionNotFoundError } from "./errors";
import { Logger } from "@verdaccio/types";

export default class Approvals {
  private approvalsDBPath: string;
  private approvals: any;
  private logger: Logger;
  constructor(approvalsDBPath: string, logger: Logger) {
    this.approvalsDBPath = approvalsDBPath;
    this.logger = logger;
    this.approvals = this.loadApprovals();
  }

  public approvePackageVersion(pkgName: string, version: string): void {
    if (!this.approvals) this.loadApprovals();
    const approved = this.isApproved(pkgName);
    if (!approved) throw new PackageVersionNotFoundError(pkgName, version);
    approved.versions.push(version);
    this.saveApprovals();
  }
  private getApprovalsFilePath(): string {
    const approvalFile = this.approvalsDBPath || "./approvals.json";
    return path.isAbsolute(approvalFile)
      ? approvalFile
      : path.join(process.cwd(), approvalFile);
  }

  /**
   * Check if a package version is approved
   */
  public isApproved(pkgName: string): any {
    if (!this.approvals) this.loadApprovals();

    // Check if package is in approval list
    return this.approvals.packages.find(
      (approved: any) => approved.name === pkgName,
    );
  }

  public isApprovedVersion(pkgName: string, version: string): boolean {
    const approved = this.isApproved(pkgName);
    if (!approved) return false;
    return approved.versions.includes(version);
  }

  /**
   * Load approvals from JSON file
   */
  private loadApprovals(): any {
    try {
      const absolutePath = this.getApprovalsFilePath();

      this.logger.debug(
        { approvalFile: absolutePath },
        "Loading approvals from file",
      );

      // Check if file exists
      if (!fs.existsSync(absolutePath)) {
        this.logger.info(
          { approvalFile: absolutePath },
          "Approvals file does not exist - creating with empty list",
        );

        const defaultApprovals = { packages: [] };

        // Create directory if it doesn't exist
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Write default approvals file
        fs.writeFileSync(
          absolutePath,
          JSON.stringify(defaultApprovals, null, 2),
          "utf8",
        );

        return defaultApprovals;
      }

      const data = fs.readFileSync(absolutePath, "utf8");
      this.approvals = data;
    } catch (err) {
      this.logger.error({ err }, "Failed to load approvals file");
      return { packages: [] };
    }
  }

  public saveApprovals() {
    const approvalsFilePath: string = this.getApprovalsFilePath();
    fs.writeFileSync(
      approvalsFilePath,
      JSON.stringify(this.approvals, null, 2),
      "utf8",
    );
  }
}
