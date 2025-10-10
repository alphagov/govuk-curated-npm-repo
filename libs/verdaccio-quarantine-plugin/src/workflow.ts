import * as fs from "node:fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import * as lockfile from "proper-lockfile";
import Ajv, { JSONSchemaType } from "ajv";
import { Logger } from "@verdaccio/types";

export enum WorkflowStatus {
  New = "New",
  InProgress = "InProgress",
  Completed = "Completed",
  Failed = "Failed",
  Cancelled = "Cancelled",
}

export interface IWorkflowItem {
  id: string;
  packageName: string;
  packageVersion?: string;
  status: WorkflowStatus;
  created: string; // ISO string for JSON serialization
  updated?: string;
}

interface IWorkflowData {
  workflowItems: IWorkflowItem[];
  transitionLog: any[];
}

interface WorkflowOptions {
  debounceMs?: number; // Debounce save operations (default: 1000ms)
  maxRetries?: number; // Max retries for file operations (default: 3)
  retryDelayMs?: number; // Delay between retries (default: 100ms)
  lockOptions?: lockfile.LockOptions; // Custom lock options
}

export default class Workflow {
  private workflowDBPath: string;
  private workflow: IWorkflowData;
  private logger: Logger;
  private ajv: Ajv;
  private saveTimer: NodeJS.Timeout | null = null;
  private pendingSave: boolean = false;
  private options: Required<WorkflowOptions>;

  // JSON Schema for validation
  private readonly workflowSchema: JSONSchemaType<IWorkflowData> = {
    type: "object",
    properties: {
      workflowItems: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            packageName: { type: "string" },
            packageVersion: { type: "string", nullable: true },
            status: {
              type: "string",
              enum: Object.values(WorkflowStatus),
            },
            created: { type: "string" },
            updated: { type: "string", nullable: true },
          },
          required: ["id", "packageName", "status", "created"],
          additionalProperties: false,
        },
      },
      transitionLog: {
        type: "array",
        items: { type: "object" },
      },
    },
    required: ["workflowItems", "transitionLog"],
    additionalProperties: false,
  };

  constructor(
    workflowDBPath: string,
    logger: Logger,
    options: WorkflowOptions = {},
  ) {
    console.log("constructor");
    this.workflowDBPath = workflowDBPath;
    this.logger = logger;
    this.options = {
      debounceMs: options.debounceMs ?? 1000,
      maxRetries: options.maxRetries ?? 3,
      retryDelayMs: options.retryDelayMs ?? 100,
      lockOptions: options.lockOptions ?? {
        stale: 10000,
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000,
        },
      },
    };

    // Initialize AJV for JSON validation
    this.ajv = new Ajv();

    this.workflow = this.loadWorkflow();
  }

  /**
   * Update an existing workflow item
   */
  public updateWorkflowItem(workflowItem: IWorkflowItem): void {
    const index = this.workflow.workflowItems.findIndex(
      (item) => item.id === workflowItem.id,
    );

    if (index === -1) {
      throw new Error(`Workflow item with id ${workflowItem.id} not found`);
    }

    // Update the timestamp
    workflowItem.updated = new Date().toISOString();

    this.workflow.workflowItems[index] = workflowItem;
    this.debouncedSave();
  }

  /**
   * Update workflow item status
   */
  public updateWorkflowItemStatus(id: string, status: WorkflowStatus): void {
    const item = this.getWorkflowItem(id);
    if (!item) {
      throw new Error(`Workflow item with id ${id} not found`);
    }

    item.status = status;
    item.updated = new Date().toISOString();

    // Log the transition
    this.workflow.transitionLog.push({
      itemId: id,
      previousStatus: item.status,
      newStatus: status,
      timestamp: new Date().toISOString(),
    });

    this.debouncedSave();
  }

  /**
   * Add a new workflow item
   */
  public addWorkflowItem(
    packageName: string,
    packageVersion?: string,
  ): IWorkflowItem {
    const workflowItem: IWorkflowItem = {
      id: uuidv4(),
      packageName: packageName,
      ...(packageVersion !== undefined && { packageVersion }),
      status: WorkflowStatus.New,
      created: new Date().toISOString(),
    };

    this.workflow.workflowItems.push(workflowItem);
    this.debouncedSave();
    this.logger.info(
      { workflowItem: workflowItem },
      `Added workflow item for package: ${packageName} version: ${packageVersion}`,
    );
    return workflowItem;
  }

  /**
   * Get workflow item by ID
   */
  public getWorkflowItem(id: string): IWorkflowItem | undefined {
    return this.workflow.workflowItems.find((item) => item.id === id);
  }

  /**
   * Get all workflow items
   */
  public getAllWorkflowItems(): IWorkflowItem[] {
    return [...this.workflow.workflowItems]; // Return a copy
  }

  /**
   * Force immediate save (flushes debounced saves)
   */
  public async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.pendingSave) {
      await this.saveWorkflow();
      this.pendingSave = false;
    }
  }

  /**
   * Cleanup method - call before destroying instance
   */
  public async destroy(): Promise<void> {
    await this.flushSave();
  }

  private getWorkflowFilePath(): string {
    const workflowFile = this.workflowDBPath || "./workflow.json";
    return path.isAbsolute(workflowFile)
      ? workflowFile
      : path.join(process.cwd(), workflowFile);
  }

  /**
   * Validate workflow data against JSON schema
   */
  private validateWorkflow(data: any): data is IWorkflowData {
    const validate = this.ajv.compile(this.workflowSchema);
    const valid = validate(data);

    if (!valid) {
      this.logger.error(
        { errors: validate.errors },
        "Workflow validation failed",
      );
      return false;
    }

    return true;
  }

  /**
   * Load workflow from JSON file with retry logic
   */
  private loadWorkflow(): IWorkflowData {
    const absolutePath = this.getWorkflowFilePath();

    return this.withRetrySync<IWorkflowData>(() => {
      try {
        this.logger.debug(
          { workflowFile: absolutePath },
          "Loading workflow from file",
        );

        // Check if file exists
        if (!fs.existsSync(absolutePath)) {
          this.logger.info(
            { workflowFile: absolutePath },
            "Workflow file does not exist - creating with empty list",
          );
          const defaultWorkflow: IWorkflowData = {
            workflowItems: [],
            transitionLog: [],
          };

          // Create directory if it doesn't exist
          const dir = path.dirname(absolutePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          // Write default workflow file
          fs.writeFileSync(
            absolutePath,
            JSON.stringify(defaultWorkflow, null, 2),
            "utf8",
          );
          return defaultWorkflow;
        }

        const data = fs.readFileSync(absolutePath, "utf8");
        const parsed = JSON.parse(data);

        // Validate structure with JSON schema
        if (!this.validateWorkflow(parsed)) {
          throw new Error("Invalid workflow file structure");
        }

        return parsed;
      } catch (err) {
        this.logger.error({ err }, "Failed to load workflow file");

        // Try to restore from backup
        const backupPath = `${absolutePath}.backup`;
        if (fs.existsSync(backupPath)) {
          this.logger.warn({}, "Attempting to restore from backup");
          try {
            const backupData = fs.readFileSync(backupPath, "utf8");
            const parsed = JSON.parse(backupData);
            if (this.validateWorkflow(parsed)) {
              this.logger.info({}, "Successfully restored from backup");
              return parsed;
            }
          } catch (backupErr) {
            this.logger.error({ err: backupErr }, "Backup restore failed");
          }
        }

        // Return default if all else fails
        return { workflowItems: [], transitionLog: [] };
      }
    });
  }

  /**
   * Debounced save - groups multiple rapid changes into single write
   */
  private debouncedSave(): void {
    this.pendingSave = true;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveWorkflow()
        .then(() => {
          this.pendingSave = false;
        })
        .catch((err) => {
          this.logger.error({ err }, "Debounced save failed");
        });
    }, this.options.debounceMs);
  }

  /**
   * Save workflow to JSON file with atomic write, locking, and retry logic
   */
  private async saveWorkflow(): Promise<void> {
    const absolutePath = this.getWorkflowFilePath();

    await this.withRetry(async () => {
      let release: (() => Promise<void>) | null = null;

      try {
        // Acquire file lock
        this.logger.debug(
          { workflowFile: absolutePath },
          "Acquiring file lock",
        );
        release = await lockfile.lock(absolutePath, this.options.lockOptions);

        const tempPath = `${absolutePath}.tmp`;
        const backupPath = `${absolutePath}.backup`;

        // Validate data before saving
        if (!this.validateWorkflow(this.workflow)) {
          throw new Error("Workflow data failed validation before save");
        }

        // Serialize the data
        const jsonData = JSON.stringify(this.workflow, null, 2);

        // Write to temporary file first (atomic operation)
        fs.writeFileSync(tempPath, jsonData, "utf8");

        // Verify the temp file can be parsed
        const verifyData = fs.readFileSync(tempPath, "utf8");
        const parsed = JSON.parse(verifyData);
        if (!this.validateWorkflow(parsed)) {
          throw new Error("Temp file validation failed");
        }

        // Create backup of current file if it exists
        if (fs.existsSync(absolutePath)) {
          fs.copyFileSync(absolutePath, backupPath);
        }

        // Atomically replace the old file with the new one
        fs.renameSync(tempPath, absolutePath);

        this.logger.debug(
          { workflowFile: absolutePath },
          "Workflow saved successfully",
        );
      } catch (err) {
        this.logger.error({ err }, "Failed to save workflow file");
        throw new Error(`Failed to save workflow: ${err}`);
      } finally {
        // Always release the lock
        if (release) {
          try {
            await release();
            this.logger.debug({}, "File lock released");
          } catch (unlockErr) {
            this.logger.warn({ err: unlockErr }, "Failed to release lock");
          }
        }
      }
    });
  }

  /**
   * Retry wrapper for file operations
   */
  private async withRetry<T>(
    operation: () => T | Promise<T>,
    retryCount: number = 0,
  ): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      if (retryCount < this.options.maxRetries) {
        this.logger.warn(
          { err, retryCount, maxRetries: this.options.maxRetries },
          "Operation failed, retrying...",
        );

        // Exponential backoff
        const delay = this.options.retryDelayMs * Math.pow(2, retryCount);
        await this.sleep(delay);

        return this.withRetry(operation, retryCount + 1);
      }

      this.logger.error(
        { err, retryCount },
        "Operation failed after max retries",
      );
      throw err;
    }
  }

  /**
   * Retry wrapper for synchronous file operations
   */
  private withRetrySync<T>(operation: () => T, retryCount: number = 0): T {
    try {
      return operation();
    } catch (err) {
      if (retryCount < this.options.maxRetries) {
        this.logger.warn(
          { err, retryCount, maxRetries: this.options.maxRetries },
          "Operation failed, retrying...",
        );

        // Synchronous sleep (blocking)
        const delay = this.options.retryDelayMs * Math.pow(2, retryCount);
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy wait - not ideal but works for sync retry
        }

        return this.withRetrySync(operation, retryCount + 1);
      }

      this.logger.error(
        { err, retryCount },
        "Operation failed after max retries",
      );
      throw err;
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Restore from backup if main file is corrupted
   */
  public restoreFromBackup(): boolean {
    try {
      const absolutePath = this.getWorkflowFilePath();
      const backupPath = `${absolutePath}.backup`;

      if (!fs.existsSync(backupPath)) {
        this.logger.error({}, "No backup file found");
        return false;
      }

      // Validate backup before restoring
      const backupData = fs.readFileSync(backupPath, "utf8");
      const parsed = JSON.parse(backupData);

      if (!this.validateWorkflow(parsed)) {
        this.logger.error({}, "Backup file is invalid");
        return false;
      }

      fs.copyFileSync(backupPath, absolutePath);
      this.workflow = this.loadWorkflow();
      this.logger.info({}, "Successfully restored from backup");
      return true;
    } catch (err) {
      this.logger.error({ err }, "Failed to restore from backup");
      return false;
    }
  }

  public getStats() {
    return {
      itemCount: this.workflow.workflowItems.length,
      fileSizeKB: fs.statSync(this.getWorkflowFilePath()).size / 1024,
    };
  }
}
