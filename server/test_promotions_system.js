const axios = require("axios");

async function testPromotions() {
  const baseURL = "http://localhost:3000/api";

  try {
    console.log("🔧 Setting up promotions tables...");

    // Setup promotions tables
    const setupResponse = await axios.post(`${baseURL}/setup/setup`);
    console.log("✅ Setup successful:", setupResponse.data.message);

    console.log("\n📋 Available promotions:", setupResponse.data.promotions);

    console.log(
      "\n🧪 Testing promotion validation (without auth - should fail)..."
    );

    try {
      const testResponse = await axios.post(`${baseURL}/promotions/validate`, {
        code: "PISOSHIPPING",
        order_amount: 600,
      });
      console.log("❌ Should have failed without auth");
    } catch (error) {
      if (error.response.status === 401) {
        console.log("✅ Correctly requires authentication");
      } else {
        console.log("❓ Unexpected error:", error.response.data);
      }
    }

    console.log("\n🔍 Testing public promotion lookup...");

    try {
      const publicResponse = await axios.get(
        `${baseURL}/promotions/PISOSHIPPING`
      );
      console.log(
        "✅ Public promotion lookup successful:",
        publicResponse.data.promotion.promotion_name
      );
    } catch (error) {
      console.log("❌ Public promotion lookup failed:", error.response?.data);
    }

    console.log("\n🎯 Testing deprecated voucher endpoint...");

    try {
      const voucherResponse = await axios.post(`${baseURL}/vouchers/validate`, {
        code: "PISOSHIPPING",
        order_amount: 600,
      });
      console.log("❓ Voucher response:", voucherResponse.data);
    } catch (error) {
      console.log(
        "✅ Voucher endpoint correctly shows deprecation:",
        error.response?.data?.message
      );
    }
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    if (error.response) {
      console.error("Response:", error.response.data);
    }
  }
}

// Run the test
testPromotions();

console.log(`
📝 INSTRUCTIONS:
1. Make sure your server is running on port 3000
2. Run this script: node test_promotions_system.js
3. If setup is successful, you can now use:
   - PISOSHIPPING (₱1 shipping on orders ₱500+)
   - FREESHIP1000 (Free shipping on orders ₱1000+)
   
🔗 Endpoints available:
- POST /api/setup/setup (setup tables - run once)
- POST /api/promotions/validate (validate promo code - requires auth)
- GET /api/promotions/PISOSHIPPING (public promo info)
- GET /api/promotions/active (all active promotions)
`);
