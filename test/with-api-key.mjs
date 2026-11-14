// Imported before dist/tools.js by tests that need a server with a 311 Public API key. tools.js
// reads NYC_311_API_KEY once, when it loads, to tell about_data which sources it cannot reach
// (unavailableSources, shared module 1.3.6). Without this, those tests would pass on a machine
// with a key and fail on CI, which has none. The value is never sent anywhere: those tests make
// no network calls.
process.env.NYC_311_API_KEY ||= "test-key-not-real";
