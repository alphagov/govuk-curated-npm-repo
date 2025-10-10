"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowStatus = void 0;
var fs = require("node:fs");
var path = require("path");
var uuid_1 = require("uuid");
var lockfile = require("proper-lockfile");
var ajv_1 = require("ajv");
var WorkflowStatus;
(function (WorkflowStatus) {
    WorkflowStatus["New"] = "New";
    WorkflowStatus["InProgress"] = "InProgress";
    WorkflowStatus["Completed"] = "Completed";
    WorkflowStatus["Failed"] = "Failed";
    WorkflowStatus["Cancelled"] = "Cancelled";
})(WorkflowStatus || (exports.WorkflowStatus = WorkflowStatus = {}));
var Workflow = /** @class */ (function () {
    function Workflow(workflowDBPath, logger, options) {
        if (options === void 0) { options = {}; }
        var _a, _b, _c, _d;
        this.saveTimer = null;
        this.pendingSave = false;
        // JSON Schema for validation
        this.workflowSchema = {
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
        console.log("constructor");
        this.workflowDBPath = workflowDBPath;
        this.logger = logger;
        this.options = {
            debounceMs: (_a = options.debounceMs) !== null && _a !== void 0 ? _a : 1000,
            maxRetries: (_b = options.maxRetries) !== null && _b !== void 0 ? _b : 3,
            retryDelayMs: (_c = options.retryDelayMs) !== null && _c !== void 0 ? _c : 100,
            lockOptions: (_d = options.lockOptions) !== null && _d !== void 0 ? _d : {
                stale: 10000,
                retries: {
                    retries: 5,
                    minTimeout: 100,
                    maxTimeout: 1000,
                },
            },
        };
        // Initialize AJV for JSON validation
        this.ajv = new ajv_1.default();
        this.workflow = this.loadWorkflow();
    }
    /**
     * Update an existing workflow item
     */
    Workflow.prototype.updateWorkflowItem = function (workflowItem) {
        var index = this.workflow.workflowItems.findIndex(function (item) { return item.id === workflowItem.id; });
        if (index === -1) {
            throw new Error("Workflow item with id ".concat(workflowItem.id, " not found"));
        }
        // Update the timestamp
        workflowItem.updated = new Date().toISOString();
        this.workflow.workflowItems[index] = workflowItem;
        this.debouncedSave();
    };
    /**
     * Update workflow item status
     */
    Workflow.prototype.updateWorkflowItemStatus = function (id, status) {
        var item = this.getWorkflowItem(id);
        if (!item) {
            throw new Error("Workflow item with id ".concat(id, " not found"));
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
    };
    /**
     * Add a new workflow item
     */
    Workflow.prototype.addWorkflowItem = function (packageName, packageVersion) {
        var workflowItem = __assign(__assign({ id: (0, uuid_1.v4)(), packageName: packageName }, (packageVersion !== undefined && { packageVersion: packageVersion })), { status: WorkflowStatus.New, created: new Date().toISOString() });
        this.workflow.workflowItems.push(workflowItem);
        this.debouncedSave();
        this.logger.info({ workflowItem: workflowItem }, "Added workflow item for package: ".concat(packageName, " version: ").concat(packageVersion));
        return workflowItem;
    };
    /**
     * Get workflow item by ID
     */
    Workflow.prototype.getWorkflowItem = function (id) {
        return this.workflow.workflowItems.find(function (item) { return item.id === id; });
    };
    /**
     * Get all workflow items
     */
    Workflow.prototype.getAllWorkflowItems = function () {
        return __spreadArray([], this.workflow.workflowItems, true); // Return a copy
    };
    /**
     * Force immediate save (flushes debounced saves)
     */
    Workflow.prototype.flushSave = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.saveTimer) {
                            clearTimeout(this.saveTimer);
                            this.saveTimer = null;
                        }
                        if (!this.pendingSave) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.saveWorkflow()];
                    case 1:
                        _a.sent();
                        this.pendingSave = false;
                        _a.label = 2;
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Cleanup method - call before destroying instance
     */
    Workflow.prototype.destroy = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.flushSave()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    Workflow.prototype.getWorkflowFilePath = function () {
        var workflowFile = this.workflowDBPath || "./workflow.json";
        return path.isAbsolute(workflowFile)
            ? workflowFile
            : path.join(process.cwd(), workflowFile);
    };
    /**
     * Validate workflow data against JSON schema
     */
    Workflow.prototype.validateWorkflow = function (data) {
        var validate = this.ajv.compile(this.workflowSchema);
        var valid = validate(data);
        if (!valid) {
            this.logger.error({ errors: validate.errors }, "Workflow validation failed");
            return false;
        }
        return true;
    };
    /**
     * Load workflow from JSON file with retry logic
     */
    Workflow.prototype.loadWorkflow = function () {
        var _this = this;
        var absolutePath = this.getWorkflowFilePath();
        return this.withRetrySync(function () {
            try {
                _this.logger.debug({ workflowFile: absolutePath }, "Loading workflow from file");
                // Check if file exists
                if (!fs.existsSync(absolutePath)) {
                    _this.logger.info({ workflowFile: absolutePath }, "Workflow file does not exist - creating with empty list");
                    var defaultWorkflow = {
                        workflowItems: [],
                        transitionLog: [],
                    };
                    // Create directory if it doesn't exist
                    var dir = path.dirname(absolutePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    // Write default workflow file
                    fs.writeFileSync(absolutePath, JSON.stringify(defaultWorkflow, null, 2), "utf8");
                    return defaultWorkflow;
                }
                var data = fs.readFileSync(absolutePath, "utf8");
                var parsed = JSON.parse(data);
                // Validate structure with JSON schema
                if (!_this.validateWorkflow(parsed)) {
                    throw new Error("Invalid workflow file structure");
                }
                return parsed;
            }
            catch (err) {
                _this.logger.error({ err: err }, "Failed to load workflow file");
                // Try to restore from backup
                var backupPath = "".concat(absolutePath, ".backup");
                if (fs.existsSync(backupPath)) {
                    _this.logger.warn({}, "Attempting to restore from backup");
                    try {
                        var backupData = fs.readFileSync(backupPath, "utf8");
                        var parsed = JSON.parse(backupData);
                        if (_this.validateWorkflow(parsed)) {
                            _this.logger.info({}, "Successfully restored from backup");
                            return parsed;
                        }
                    }
                    catch (backupErr) {
                        _this.logger.error({ err: backupErr }, "Backup restore failed");
                    }
                }
                // Return default if all else fails
                return { workflowItems: [], transitionLog: [] };
            }
        });
    };
    /**
     * Debounced save - groups multiple rapid changes into single write
     */
    Workflow.prototype.debouncedSave = function () {
        var _this = this;
        this.pendingSave = true;
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(function () {
            _this.saveWorkflow()
                .then(function () {
                _this.pendingSave = false;
            })
                .catch(function (err) {
                _this.logger.error({ err: err }, "Debounced save failed");
            });
        }, this.options.debounceMs);
    };
    /**
     * Save workflow to JSON file with atomic write, locking, and retry logic
     */
    Workflow.prototype.saveWorkflow = function () {
        return __awaiter(this, void 0, void 0, function () {
            var absolutePath;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        absolutePath = this.getWorkflowFilePath();
                        return [4 /*yield*/, this.withRetry(function () { return __awaiter(_this, void 0, void 0, function () {
                                var release, tempPath, backupPath, jsonData, verifyData, parsed, err_1, unlockErr_1;
                                return __generator(this, function (_a) {
                                    switch (_a.label) {
                                        case 0:
                                            release = null;
                                            _a.label = 1;
                                        case 1:
                                            _a.trys.push([1, 3, 4, 9]);
                                            // Acquire file lock
                                            this.logger.debug({ workflowFile: absolutePath }, "Acquiring file lock");
                                            return [4 /*yield*/, lockfile.lock(absolutePath, this.options.lockOptions)];
                                        case 2:
                                            release = _a.sent();
                                            tempPath = "".concat(absolutePath, ".tmp");
                                            backupPath = "".concat(absolutePath, ".backup");
                                            // Validate data before saving
                                            if (!this.validateWorkflow(this.workflow)) {
                                                throw new Error("Workflow data failed validation before save");
                                            }
                                            jsonData = JSON.stringify(this.workflow, null, 2);
                                            // Write to temporary file first (atomic operation)
                                            fs.writeFileSync(tempPath, jsonData, "utf8");
                                            verifyData = fs.readFileSync(tempPath, "utf8");
                                            parsed = JSON.parse(verifyData);
                                            if (!this.validateWorkflow(parsed)) {
                                                throw new Error("Temp file validation failed");
                                            }
                                            // Create backup of current file if it exists
                                            if (fs.existsSync(absolutePath)) {
                                                fs.copyFileSync(absolutePath, backupPath);
                                            }
                                            // Atomically replace the old file with the new one
                                            fs.renameSync(tempPath, absolutePath);
                                            this.logger.debug({ workflowFile: absolutePath }, "Workflow saved successfully");
                                            return [3 /*break*/, 9];
                                        case 3:
                                            err_1 = _a.sent();
                                            this.logger.error({ err: err_1 }, "Failed to save workflow file");
                                            throw new Error("Failed to save workflow: ".concat(err_1));
                                        case 4:
                                            if (!release) return [3 /*break*/, 8];
                                            _a.label = 5;
                                        case 5:
                                            _a.trys.push([5, 7, , 8]);
                                            return [4 /*yield*/, release()];
                                        case 6:
                                            _a.sent();
                                            this.logger.debug({}, "File lock released");
                                            return [3 /*break*/, 8];
                                        case 7:
                                            unlockErr_1 = _a.sent();
                                            this.logger.warn({ err: unlockErr_1 }, "Failed to release lock");
                                            return [3 /*break*/, 8];
                                        case 8: return [7 /*endfinally*/];
                                        case 9: return [2 /*return*/];
                                    }
                                });
                            }); })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Retry wrapper for file operations
     */
    Workflow.prototype.withRetry = function (operation_1) {
        return __awaiter(this, arguments, void 0, function (operation, retryCount) {
            var err_2, delay;
            if (retryCount === void 0) { retryCount = 0; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 5]);
                        return [4 /*yield*/, operation()];
                    case 1: return [2 /*return*/, _a.sent()];
                    case 2:
                        err_2 = _a.sent();
                        if (!(retryCount < this.options.maxRetries)) return [3 /*break*/, 4];
                        this.logger.warn({ err: err_2, retryCount: retryCount, maxRetries: this.options.maxRetries }, "Operation failed, retrying...");
                        delay = this.options.retryDelayMs * Math.pow(2, retryCount);
                        return [4 /*yield*/, this.sleep(delay)];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, this.withRetry(operation, retryCount + 1)];
                    case 4:
                        this.logger.error({ err: err_2, retryCount: retryCount }, "Operation failed after max retries");
                        throw err_2;
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Retry wrapper for synchronous file operations
     */
    Workflow.prototype.withRetrySync = function (operation, retryCount) {
        if (retryCount === void 0) { retryCount = 0; }
        try {
            return operation();
        }
        catch (err) {
            if (retryCount < this.options.maxRetries) {
                this.logger.warn({ err: err, retryCount: retryCount, maxRetries: this.options.maxRetries }, "Operation failed, retrying...");
                // Synchronous sleep (blocking)
                var delay = this.options.retryDelayMs * Math.pow(2, retryCount);
                var start = Date.now();
                while (Date.now() - start < delay) {
                    // Busy wait - not ideal but works for sync retry
                }
                return this.withRetrySync(operation, retryCount + 1);
            }
            this.logger.error({ err: err, retryCount: retryCount }, "Operation failed after max retries");
            throw err;
        }
    };
    /**
     * Sleep utility for retry delays
     */
    Workflow.prototype.sleep = function (ms) {
        return new Promise(function (resolve) { return setTimeout(resolve, ms); });
    };
    /**
     * Restore from backup if main file is corrupted
     */
    Workflow.prototype.restoreFromBackup = function () {
        try {
            var absolutePath = this.getWorkflowFilePath();
            var backupPath = "".concat(absolutePath, ".backup");
            if (!fs.existsSync(backupPath)) {
                this.logger.error({}, "No backup file found");
                return false;
            }
            // Validate backup before restoring
            var backupData = fs.readFileSync(backupPath, "utf8");
            var parsed = JSON.parse(backupData);
            if (!this.validateWorkflow(parsed)) {
                this.logger.error({}, "Backup file is invalid");
                return false;
            }
            fs.copyFileSync(backupPath, absolutePath);
            this.workflow = this.loadWorkflow();
            this.logger.info({}, "Successfully restored from backup");
            return true;
        }
        catch (err) {
            this.logger.error({ err: err }, "Failed to restore from backup");
            return false;
        }
    };
    Workflow.prototype.getStats = function () {
        return {
            itemCount: this.workflow.workflowItems.length,
            fileSizeKB: fs.statSync(this.getWorkflowFilePath()).size / 1024,
        };
    };
    return Workflow;
}());
exports.default = Workflow;
