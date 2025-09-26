import { Request, Response, NextFunction, Application } from "express";
import { ApprovalManager } from "./approval-manager";
import { PackageScanner } from "./scanner";
import { Logger } from "@verdaccio/types";

export interface QuarantineMiddleware {
  apiRoutes(app: Application): void;
  packageInterceptor(): (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<void>;
}

export function createQuarantineMiddleware(
  approvalManager: ApprovalManager,
  _scanner: PackageScanner,
  _quarantinePath: string,
  logger: Logger,
): QuarantineMiddleware {
  function apiRoutes(app: Application): void {
    // Get all package requests
    app.get(
      "/requests",
      async (_req: Request, res: Response): Promise<void> => {
        try {
          const requests = await approvalManager.getAllRequests();
          res.json(requests);
        } catch (error) {
          logger.error(
            { plugin: "quarantine", error },
            "Failed to get requests",
          );
          res.status(500).json({ error: "Failed to retrieve requests" });
        }
      },
    );

    // Approve a package
    app.put(
      "/approve/:package(*)",
      async (req: Request, res: Response): Promise<any> => {
        const rawPackageName = req.params["package"];
        if (!rawPackageName) {
          return res.status(400).json({
            error: "Package parameter is missing",
            message: "Package name must be provided in the URL",
          });
        }
        try {
          const packageName: string = decodeURIComponent(rawPackageName);
          await approvalManager.approvePackage(packageName);
          logger.info(
            { plugin: "quarantine", package: packageName },
            "Package approved",
          );
          res.status(201).json({ message: `Package ${packageName} approved` });
        } catch (error) {
          logger.error(
            { plugin: "quarantine", error },
            `Failed to approve package ${rawPackageName}`,
          );
          res
            .status(500)
            .json({ error: `Failed to approve package ${rawPackageName}` });
        }
      },
    );

    // Get package risk assessment
    app.get(
      "/scan/:package(*)",
      async (req: Request, res: Response): Promise<any> => {
        const rawPackageName = req.params["package"];
        if (!rawPackageName) {
          return res.status(400).json({
            error: "Package parameter is missing",
            message: "Package name must be provided in the URL",
          });
        }
        try {
          const packageName = decodeURIComponent(rawPackageName);
          const assessment =
            await approvalManager.getRiskAssessment(packageName);
          res.status(200).json(assessment);
        } catch (error) {
          logger.error(
            { plugin: "quarantine", error },
            `Failed to get risk assessment for package ${rawPackageName}`,
          );
          res.status(500).json({
            error: `Failed to get risk assessment for package ${rawPackageName}`,
          });
        }
      },
    );

    // Get blocked attempts log
    app.get("/blocked", async (_req: Request, res: Response): Promise<void> => {
      try {
        const attempts = await approvalManager.getBlockedAttempts();
        res.json(attempts);
      } catch (error) {
        logger.error(
          { plugin: "quarantine", error },
          "Failed to get blocked attempts",
        );
        res.status(500).json({ error: "Failed to get blocked attempts" });
      }
    });

    return;
  }

  function packageInterceptor() {
    return async (
      req: Request,
      res: Response,
      next: NextFunction,
    ): Promise<any> => {
      logger.info(
        { plugin: "quarantine" },
        `req.method:${req.method} req.params["package"]:${req.params["package"]}`,
      );
      // Only intercept GET requests for package tarballs
      if (req.method != "GET" || req.url.includes("/-/")) {
        next();
        return;
      }
      const rawPackageName = req.params["package"];
      if (!rawPackageName) {
        next();
        return;
      }

      const packageName = decodeURIComponent(rawPackageName);

      try {
        const approvalStatus =
          await approvalManager.getApprovalStatus(packageName);

        if (approvalStatus === "blocked") {
          // Log the blocked attempt
          await approvalManager.logBlockedAttempt(
            packageName,
            req.ip || "unknown",
            req.get("user-agent") || "",
          );
          res.status(403).json({
            error: "Package not approved",
            message: `Package ${packageName} is pending approval. Contact your administrator.`,
            package: packageName,
          });
          return;
        }

        if (approvalStatus === "pending") {
          res.status(403).json({
            error: "Package under review",
            message:
              "Package ${packageName} is currently being reviewed for security.",
            package: packageName,
          });
          return;
        }

        // Package is approved or not yet requested - let it through
        next();
      } catch (error) {
        logger.error(
          { plugin: "quarantine", error, package: packageName },
          `Error checking approval status for package ${packageName}`,
        );
        next();
      }
    };
  }

  return { apiRoutes, packageInterceptor };
}
