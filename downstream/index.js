const startServer = require("verdaccio").default;

let config = {
  store: {
    "quarantine-plugin": {
      approvalListPath: "./approvals.json",
      uplinks: {
        npmjs: {
          url: "http://verdaccio-upstream:4873",
        },
      },
    },
  },
  middlewares: {
    "approval-plugin": {
      enabled: true,
      quarantinePath: "/verdaccio/quarantine",
      autoscan: true,
    },
  },
  auth: {
    htpasswd: {
      file: "./htpasswd",
    },
  },
  uplinks: {},
  self_path: "./",
  packages: {
    "@*/*": {
      access: "$all",
      publish: "$authenticated",
      proxy: "npmjs",
    },
    "**": {
      access: "$all",
      proxy: "npmjs",
    },
  },
  logs: [
    {
      type: "stdout",
      format: "pretty",
      level: "debug",
    },
  ],
};

startServer(
  config,
  4873,
  undefined,
  "1.0.0",
  "verdaccio",
  (webServer, addrs) => {
    webServer.listen(addrs.port || addrs.path, "0.0.0.0", () => {
      console.log(`verdaccio running on : ${addrs.host}:${addrs.port}`);
    });
  },
);
