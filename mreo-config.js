/* Use "connected" only after deploying backend/worker.js and configuring Stripe. */
window.MREO_CONFIG = Object.freeze({
  mode: "demo",
  apiBase: "",
  defaultDays: 1,
  standardDays: 21,
  participationCents: 100,
  sellerSuccessFee: 1000
});
