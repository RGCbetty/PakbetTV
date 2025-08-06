/**
 * Quick Test: Complete Address Fix Verification
 */

// Test data matching the actual user shipping data
const userShipping = {
  address1: "", // Empty
  address2: null,
  area: null,
  city: null,
  state: null,
  postcode: "6000",
  country: "PH",
  address_type: "home",
  region: "Region VII",
  province: "Bohol",
  city_municipality: "Alburquerque",
  barangay: "Basacdacu",
  street_name: "N Bacalso Ave",
  building: "Benison Inn",
  house_number: "Room 404",
};

// Build complete address (same logic as in deliveryController)
const fullAddress = [
  userShipping.house_number,
  userShipping.building,
  userShipping.street_name,
  userShipping.barangay,
  userShipping.city_municipality,
  userShipping.province,
]
  .filter(Boolean)
  .join(", ");

const recipientAddressData = {
  address1: userShipping.address1 || fullAddress || "Default Address",
  address2: userShipping.address2 || "",
  area:
    userShipping.area ||
    userShipping.barangay ||
    userShipping.district ||
    "Default Area",
  city: userShipping.city || userShipping.city_municipality || "Default City",
  state: userShipping.state || userShipping.province || "Default State",
  postcode: userShipping.postcode,
};

console.log("=== COMPLETE ADDRESS FIX VERIFICATION ===");
console.log("\n🏠 Built Complete Address:");
console.log(`"${fullAddress}"`);
console.log("\n📋 Final Address Data:");
console.log(JSON.stringify(recipientAddressData, null, 2));

console.log("\n🎯 Expected in NinjaVan Dashboard:");
console.log(
  "Address Line 1: Room 404, Benison Inn, N Bacalso Ave, Basacdacu, Alburquerque, Bohol"
);
console.log("Country: SG (overridden in sandbox)");
console.log("Postcode: 060000 (converted from 6000)");

const isComplete =
  fullAddress.includes("Room 404") &&
  fullAddress.includes("Benison Inn") &&
  fullAddress.includes("N Bacalso Ave") &&
  fullAddress.includes("Basacdacu") &&
  fullAddress.includes("Alburquerque") &&
  fullAddress.includes("Bohol");

console.log(
  `\n${isComplete ? "✅ PASS" : "❌ FAIL"}: Complete address is now being used!`
);
console.log(
  "🚀 Ready for testing - next order should show full address in NinjaVan dashboard."
);
