const startServer = require("verdaccio").default;

let config = {
  storage: "./storage",
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
  uplinks: {
    npmjs: {
      url: "http://verdaccio-upstream:4873",
    },
  },
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
  log: {
    type: "stdout",
    format: "pretty",
    level: "http",
  },
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
