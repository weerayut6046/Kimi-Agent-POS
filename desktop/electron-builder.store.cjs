const path = require("node:path");

const testIdentity = process.env.PUMPPOS_STORE_TEST_IDENTITY === "1";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy the exact value from Partner Center > Product identity.`
    );
  }
  return value;
}

const identityName = testIdentity
  ? "KimiAgentPumpPOS.Test"
  : required("PUMPPOS_STORE_IDENTITY_NAME");
const publisher = testIdentity
  ? "CN=KimiAgentPumpPOSTest"
  : required("PUMPPOS_STORE_PUBLISHER");
const publisherDisplayName = testIdentity
  ? "Kimi Agent PumpPOS Test"
  : required("PUMPPOS_STORE_PUBLISHER_DISPLAY_NAME");
const applicationId = (
  process.env.PUMPPOS_STORE_APPLICATION_ID || "PumpPOS"
).trim();

if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) {
  throw new Error(
    "PUMPPOS_STORE_IDENTITY_NAME is not a valid AppX identity name."
  );
}
if (!/^CN=.+/i.test(publisher) || /[<>]/.test(publisher)) {
  throw new Error(
    "PUMPPOS_STORE_PUBLISHER must be the exact Partner Center CN value."
  );
}
if (!/^([A-Za-z][A-Za-z0-9]*)(\.[A-Za-z][A-Za-z0-9]*)*$/.test(applicationId)) {
  throw new Error(
    "PUMPPOS_STORE_APPLICATION_ID is not a valid AppX application id."
  );
}

module.exports = {
  extends: path.join(__dirname, "electron-builder.yml"),
  directories: {
    output: testIdentity ? "release/store-test" : "release/store",
  },
  forceCodeSigning: false,
  win: {
    icon: "app.ico",
    target: [
      {
        target: "appx",
        arch: ["x64"],
      },
    ],
  },
  appx: {
    identityName,
    publisher,
    publisherDisplayName,
    applicationId,
    displayName: "PumpPOS",
    backgroundColor: "#FFFFFF",
    languages: ["th-TH", "en-US"],
    electronUpdaterAware: false,
    artifactName: "PumpPOS-Store-${version}-${arch}.${ext}",
  },
  publish: null,
};
