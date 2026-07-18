(function (/** @type {any} */ root) {
  "use strict";
  const ApplyOS = /** @type {any} */ (root.ApplyOS = root.ApplyOS || {});
  ApplyOS.CLOUD_DEFAULTS = Object.freeze({
    // Public staging configuration for the stable unpacked development path.
    // Provider and server secrets remain exclusively in Supabase.
    projectUrl: "https://hkmrpkxiaadhlwpieyve.supabase.co",
    publishableKey: "sb_publishable_o2fYwuTsKeIJFTrcu2xp4w_1hB9NChJ",
    accountRequired: true,
    providers: Object.freeze({
      emailOtp: true,
      google: "google",
      linkedin: "linkedin_oidc"
    }),
    supportFunction: "submit-support-report",
    deleteFunction: "delete-account",
    buildMode: "development",
    // Development source builds may be pointed at a local Supabase instance by
    // automated tests. Production builds replace this file and disable it.
    allowRuntimeConfig: true
  });
})(globalThis);
