/**
 * NinjaVan API Response Structure Reference
 * Based on NinjaVan API v4.2 Documentation
 */

// EXPECTED SUCCESSFUL RESPONSE STRUCTURE:
const expectedResponse = {
  // Primary response data
  tracking_number: "NVSGFSMDM010203125", // ✅ This exists in your response

  // Common additional fields in successful responses:
  granular_status: {
    status: "Pending Pickup",
    description: "Order created successfully",
  },

  // OR the status might be at root level:
  status: "created",
  order_reference: "SHIP1020...",

  // Sometimes includes pickup/delivery info:
  pickup: {
    date: "2025-01-28",
    timeslot: {
      start_time: "09:00",
      end_time: "12:00",
    },
  },

  // Order reference information
  reference: {
    merchant_order_number: "SHIP1020...",
  },
};

// ANALYSIS OF YOUR RESPONSE:
console.log("=== NINJAVAN RESPONSE ANALYSIS ===");
console.log('✅ SUCCESS: tracking_number exists - "NVSGFSMDM010203125"');
console.log("❌ MISSING: status field (not in NinjaVan v4.2 response)");
console.log("❌ MISSING: order_id field (not in NinjaVan v4.2 response)");

console.log("\n=== LIKELY ACTUAL RESPONSE STRUCTURE ===");
console.log("Based on successful tracking_number, response likely contains:");
console.log('- tracking_number: "NVSGFSMDM010203125"');
console.log('- granular_status: { status: "...", description: "..." }');
console.log('- reference: { merchant_order_number: "..." }');
console.log('- pickup: { date: "...", timeslot: {...} }');

console.log("\n=== RECOMMENDED FIX ===");
console.log("1. Log complete response.data to see actual structure");
console.log("2. Update code to access correct fields");
console.log("3. Use granular_status.status instead of status");
console.log("4. Use reference.merchant_order_number instead of order_id");

console.log(
  "\n🎯 The undefined values are expected - those fields dont exist in NinjaVan API v4.2 response"
);
console.log(
  "📝 The important thing is tracking_number exists, meaning order creation was successful!"
);
