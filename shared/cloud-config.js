(function (/** @type {any} */ root) {
  "use strict";
  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  ApplyOS.CLOUD_DEFAULTS = Object.freeze({
    projectUrl: "",
    publishableKey: "",
    provider: "linkedin_oidc",
    supportFunction: "submit-support-report",
    deleteFunction: "delete-account"
  });
})(globalThis);
