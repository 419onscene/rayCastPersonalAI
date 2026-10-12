const raycast = require("@raycast/eslint-config");

module.exports = [{ ignores: ["dist/**", "dist-tests/**", "node_modules/**", "eslint.config.js"] }, ...raycast];
