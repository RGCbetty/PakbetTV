#!/usr/bin/env node

/**
 * Environment Status Checker
 * Quickly check if the system is in sandbox or production mode
 */

require("dotenv").config();
const config = require("./config/keys");

console.log("🔍 API Environment Status Check");
console.log("================================\n");

// DragonPay Status
console.log("🐉 DRAGONPAY CONFIGURATION");
console.log(`   Environment: ${config.DRAGONPAY_ENV.toUpperCase()}`);
console.log(`   Merchant ID: ${config.DRAGONPAY_MERCHANT_ID}`);
console.log(`   Base URL: ${config.DRAGONPAY_BASE_URL}`);
console.log(`   API URL: ${config.DRAGONPAY_API_URL}`);

if (config.DRAGONPAY_ENV === "sandbox") {
  console.log("   🧪 STATUS: SANDBOX MODE - Safe for testing");
} else {
  console.log("   🚀 STATUS: PRODUCTION MODE - Live transactions");
}

console.log("\n🚚 NINJAVAN CONFIGURATION");
console.log(`   Environment: ${config.NINJAVAN_ENV.toUpperCase()}`);
console.log(`   Country: ${config.NINJAVAN_COUNTRY_CODE}`);
console.log(`   API URL: ${config.NINJAVAN_API_URL}`);
console.log(`   Client ID: ${config.NINJAVAN_CLIENT_ID}`);

if (config.NINJAVAN_ENV === "sandbox") {
  console.log("   🧪 STATUS: SANDBOX MODE - Safe for testing");
} else {
  console.log("   🚀 STATUS: PRODUCTION MODE - Live orders");
}

// Overall Status
console.log("\n📊 OVERALL STATUS");
const bothSandbox =
  config.DRAGONPAY_ENV === "sandbox" && config.NINJAVAN_ENV === "sandbox";
const bothProduction =
  config.DRAGONPAY_ENV === "production" && config.NINJAVAN_ENV === "production";

if (bothSandbox) {
  console.log("   🧪 BOTH SERVICES IN SANDBOX - Safe for testing");
} else if (bothProduction) {
  console.log("   🚀 BOTH SERVICES IN PRODUCTION - Live environment");
} else {
  console.log("   ⚠️  MIXED ENVIRONMENTS - This may cause issues!");
  console.log("   💡 Recommendation: Use same environment for both services");
}

console.log("\n🔧 TO SWITCH ENVIRONMENTS:");
console.log("   • Edit the .env file");
console.log("   • Change DRAGONPAY_ENV and NINJAVAN_ENV values");
console.log("   • Uncomment/comment the appropriate credential lines");
console.log("   • Restart the server");

console.log("\n📝 AVAILABLE VALUES:");
console.log("   • sandbox   - For testing");
console.log("   • production - For live operations");
