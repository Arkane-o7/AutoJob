export {};

declare global {
  var chrome: any;
  var ApplyOS: any;
  var ScoutDialog: any;
  function importScripts(...urls: string[]): void;
  interface GlobalThis {
    ApplyOS: any;
    chrome: any;
    ScoutDialog: any;
  }
}
