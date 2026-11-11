// Deployment settings. Edit this file before building, or edit the hosted
// config.js after uploading dist/. No rebuild is needed for hosted changes.
// index.html loads this script before app.js reads the global below.
globalThis.FEDISTACK_CONFIG = {
  // An HTTPS instance domain or origin, for example "social.example.org".
  defaultServer: "",
  // Set false to hide the server picker and allow sign-in only to defaultServer.
  allowOtherServers: true,
};
