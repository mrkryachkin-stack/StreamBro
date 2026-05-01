// Stub signer — used during dev/test builds when no Code Signing certificate
// is available. electron-builder calls exports.default(configuration) for
// every artifact; we just no-op so the build can complete unsigned.
//
// When you buy an EV cert (Sectigo / DigiCert), replace this with a real
// signtool wrapper or set CSC_LINK / CSC_KEY_PASSWORD env vars and remove
// the 'sign' field from package.json's win.signtoolOptions.
exports.default = async function () {
  // intentional no-op
};
