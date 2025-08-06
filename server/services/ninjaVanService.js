const axios = require("axios");
const config = require("../config/keys");
const ninjaVanAuth = require("./ninjaVanAuth");

const API_BASE_URL = config.NINJAVAN_API_URL;
const COUNTRY_CODE = config.NINJAVAN_COUNTRY_CODE;
const NINJAVAN_ENV = config.NINJAVAN_ENV;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Cache for waybills
const waybillCache = new Map();

console.log("🚚 NinjaVan Service Configuration:", {
  environment: NINJAVAN_ENV,
  apiUrl: API_BASE_URL,
  countryCode: COUNTRY_CODE,
  note:
    NINJAVAN_ENV === "sandbox"
      ? "Using SG country code for sandbox testing"
      : "Using actual country code for production",
});

/**
 * Format phone number based on country code
 */
function formatPhoneNumber(phone, countryCode) {
  if (!phone) return "";

  // Clean the phone number
  const cleanPhone = phone.replace(/[\s\-\(\)\.]/g, "");

  if (countryCode === "SG") {
    // Singapore format: +65XXXXXXXX
    if (cleanPhone.startsWith("+65")) return cleanPhone;
    if (cleanPhone.startsWith("65")) return "+" + cleanPhone;
    if (cleanPhone.match(/^[89]\d{7}$/)) return "+65" + cleanPhone;
    return "+6591234567"; // Default Singapore number for testing
  } else {
    // Philippines format: +63XXXXXXXXXX
    if (cleanPhone.startsWith("+63")) return cleanPhone;
    if (cleanPhone.startsWith("63")) return "+" + cleanPhone;
    if (cleanPhone.startsWith("0")) return "+63" + cleanPhone.substring(1);
    if (cleanPhone.match(/^9\d{9}$/)) return "+63" + cleanPhone;
    return cleanPhone; // Return as is if already formatted
  }
}

/**
 * Format address for NinjaVan based on country code
 */
function formatAddressForCountry(address, countryCode) {
  if (countryCode === "SG") {
    // For Singapore sandbox, use Singapore-format addresses with proper validation
    // Use more realistic Singapore addresses that match their postal system
    return {
      address1: address.address1
        ? `${address.address1} Singapore Street`
        : "123 Singapore Street",
      address2: address.address2 || "",
      area: "Central Singapore", // Use a standard Singapore area
      city: "Singapore", // Must be Singapore for SG
      state: "Singapore", // Must be Singapore for SG
      address_type: address.address_type || "home",
      country: "SG",
      postcode: "018956", // Use a real Singapore postcode format
    };
  }

  // For Philippines (production), use as provided but with validation
  return {
    address1: address.address1 || "",
    address2: address.address2 || "",
    area: address.area || address.city || "",
    city: address.city || "",
    state: address.state || "",
    address_type: address.address_type || "home",
    country: "PH",
    postcode: address.postcode || "",
  };
}
/**
 * Sleep function for retry delays
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry function with exponential backoff
 */
async function retryWithBackoff(fn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      // Don't retry on 4xx errors
      if (error.response?.status < 500) {
        throw error;
      }

      // On last retry, throw error
      if (i === retries - 1) {
        throw error;
      }

      // Wait with exponential backoff
      await sleep(RETRY_DELAY * Math.pow(2, i));
    }
  }
}

/**
 * Create a delivery order with NinjaVan
 * @param {Object} orderData - Order information including items and payment method
 * @param {Object|String} shippingAddress - Address details
 * @param {Object} customerInfo - Customer information
 * @returns {Object} Delivery response from NinjaVan
 */
async function createDeliveryOrder(orderData, shippingAddress, customerInfo) {
  try {
    // Validate required customer information
    if (!customerInfo.phone || !customerInfo.phone.trim()) {
      throw new Error("Customer phone number is required for delivery");
    }

    if (!customerInfo.email || !customerInfo.email.trim()) {
      throw new Error("Customer email is required for delivery");
    }

    if (!customerInfo.first_name || !customerInfo.first_name.trim()) {
      throw new Error("Customer name is required for delivery");
    }

    let address1 = "",
      address2 = "",
      area = "",
      city = "",
      state = "",
      postcode = "";

    // Validate and format shipping address
    if (typeof shippingAddress === "string") {
      // Parse string address
      const addressParts = shippingAddress
        .split(",")
        .map((part) => part.trim());
      // Extract address components more reliably
      address1 = addressParts[0] || "";
      // Extract postcode with validation
      const postcodeMatch = shippingAddress.match(/\b\d{5,6}\b/);
      postcode = postcodeMatch ? postcodeMatch[0] : "";
      // Extract city and state more reliably
      const remainingParts = addressParts.filter(
        (part) => !part.match(/\b\d{5,6}\b/)
      );
      if (remainingParts.length >= 2) {
        city = remainingParts[remainingParts.length - 2] || "";
        state = remainingParts[remainingParts.length - 1] || "";
        // If there are parts between address1 and city, use them as area
        if (remainingParts.length > 2) {
          area = remainingParts.slice(1, -2).join(", ");
        }
      }
    } else if (
      typeof shippingAddress === "object" &&
      shippingAddress !== null
    ) {
      // Use shipping address object with validation
      address1 = shippingAddress.address1 || "";
      address2 = shippingAddress.address2 || "";
      area = shippingAddress.area || "";
      city = shippingAddress.city || "";
      state = shippingAddress.state || "";
      postcode = shippingAddress.postcode || "";
    }

    // Validate required address fields
    if (!address1 || !city || !state || !postcode) {
      throw new Error(
        "Missing required address fields. Please ensure address1, city, state, and postcode are provided."
      );
    }

    // Format address components
    address1 = address1.trim();
    city = city.trim();
    state = state.trim();
    postcode = postcode.trim();

    // Generate consistent tracking number format
    const timestamp = Date.now();
    const requestedTrackingNumber = `${orderData.order_id}${timestamp}`.slice(
      -9
    );

    // Calculate total weight from items
    const totalWeight = orderData.items
      ? orderData.items.reduce(
          (total, item) => total + (item.quantity || 1) * 0.5,
          0
        )
      : 0.5;

    // Format phone numbers for the specific region
    const formattedCustomerPhone = formatPhoneNumber(
      customerInfo.phone,
      COUNTRY_CODE
    );
    const formattedShopPhone = formatPhoneNumber("+639811949999", COUNTRY_CODE);

    // Format addresses for the specific region
    const shopAddress = formatAddressForCountry(
      {
        address1:
          COUNTRY_CODE === "SG"
            ? "1 Raffles Place"
            : "Unit 1004 Cityland Shaw Tower Corner St. Francis, Shaw Blvd.",
        address2: COUNTRY_CODE === "SG" ? "#12-34" : "",
        area: COUNTRY_CODE === "SG" ? "Central Singapore" : "Mandaluyong City",
        city: COUNTRY_CODE === "SG" ? "Singapore" : "Mandaluyong City",
        state: COUNTRY_CODE === "SG" ? "Singapore" : "NCR",
        address_type: "office",
        country: COUNTRY_CODE,
        postcode: COUNTRY_CODE === "SG" ? "048616" : "486015",
      },
      COUNTRY_CODE
    );

    const customerAddress = formatAddressForCountry(
      {
        address1: address1,
        address2: address2,
        area: area || city,
        city: city,
        state: state,
        address_type: "home",
        country: COUNTRY_CODE,
        postcode: postcode,
      },
      COUNTRY_CODE
    );

    // Create delivery request with validated address and updated from address
    const deliveryRequest = {
      requested_tracking_number: requestedTrackingNumber,
      service_type: "Parcel",
      service_level: "Standard",
      reference: {
        merchant_order_number: `SHIP-${orderData.order_id}`,
      },
      from: {
        name: "Feng Shui by Pakbet TV",
        phone_number: formattedShopPhone,
        email: "store@fengshui-ecommerce.com",
        address: shopAddress,
      },
      to: {
        name: `${customerInfo.first_name} ${
          customerInfo.last_name || ""
        }`.trim(),
        phone_number: formattedCustomerPhone,
        email: customerInfo.email,
        address: customerAddress,
      },
      parcel_job: {
        is_pickup_required: true,
        pickup_service_type: "Scheduled",
        pickup_service_level: "Standard",
        pickup_date: new Date(Date.now() + 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
        pickup_timeslot: {
          start_time: "09:00",
          end_time: "18:00",
          timezone: COUNTRY_CODE === "SG" ? "Asia/Singapore" : "Asia/Manila",
        },
        pickup_instructions: "Pickup with care!",
        delivery_instructions: "Please handle with care",
        delivery_start_date: new Date(Date.now() + 48 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
        delivery_timeslot: {
          start_time: "09:00",
          end_time: "22:00",
          timezone: COUNTRY_CODE === "SG" ? "Asia/Singapore" : "Asia/Manila",
        },
        dimensions: {
          weight: totalWeight > 0 ? totalWeight : 0.5,
        },
        items: orderData.items
          ? orderData.items.map((item) => ({
              item_description: item.name || "Product item",
              quantity: item.quantity || 1,
              is_dangerous_good: false,
            }))
          : [
              {
                item_description: "Product from order",
                quantity: 1,
                is_dangerous_good: false,
              },
            ],
      },
    };

    // Add COD parameters if payment method is 'cod'
    if (orderData.payment_method === "cod") {
      let codAmount = parseFloat(orderData.total_amount);
      let codCurrency = COUNTRY_CODE === "SG" ? "SGD" : "PHP";

      // For Singapore sandbox, convert PHP to SGD (rough conversion for testing)
      if (COUNTRY_CODE === "SG") {
        codAmount = Math.round(codAmount * 0.027 * 100) / 100; // Convert PHP to SGD (approximate rate)
        // Ensure minimum SGD amount for testing
        if (codAmount < 1) codAmount = 10.0;
      }

      deliveryRequest.parcel_job.cash_on_delivery = codAmount;
      deliveryRequest.parcel_job.cash_on_delivery_currency = codCurrency;

      console.log(
        `COD enabled for order ${orderData.order_id}: ${codAmount} ${codCurrency}`
      );
    }

    // Log the request payload for debugging
    console.log(
      "🚚 [NINJAVAN] Creating order with payload:",
      JSON.stringify(deliveryRequest, null, 2)
    );
    console.log(
      "🚚 [NINJAVAN] API URL:",
      `${API_BASE_URL}/${COUNTRY_CODE}/4.2/orders`
    );

    // Get NinjaVan token and create delivery with retries
    const token = await ninjaVanAuth.getValidToken();

    // DEBUG: Log token information (server-side only)
    console.log("🔐 [NINJAVAN] Token Debug Info:", {
      tokenLength: token ? token.length : 0,
      tokenStart: token ? token.substring(0, 20) + "..." : "No token",
      environment: NINJAVAN_ENV,
      apiUrl: API_BASE_URL,
      countryCode: COUNTRY_CODE,
      timestamp: new Date().toISOString(),
    });

    const createOrder = async () => {
      console.log("📤 [NINJAVAN] Making API request to create order...");
      console.log("📋 [NINJAVAN] Request Headers:", {
        Authorization: `Bearer ${token.substring(0, 20)}...`,
        "Content-Type": "application/json",
      });

      const response = await axios.post(
        `${API_BASE_URL}/${COUNTRY_CODE}/4.2/orders`,
        deliveryRequest,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📥 [NINJAVAN] API Response received:", {
        status: response.status,
        statusText: response.statusText,
        trackingNumber: response.data?.tracking_number,
        responseDataKeys: Object.keys(response.data || {}),
      });

      return response.data;
    };

    return await retryWithBackoff(createOrder);
  } catch (error) {
    // Enhanced error logging for 4xx errors
    if (error.response?.status >= 400 && error.response?.status < 500) {
      console.error("🚨 [NINJAVAN] API Validation Error:");
      console.error("   Status:", error.response.status);
      console.error("   Status Text:", error.response.statusText);
      console.error("   Order ID:", orderData.order_id);
      console.error(
        "   Request URL:",
        `${API_BASE_URL}/${COUNTRY_CODE}/4.2/orders`
      );

      if (error.response.data?.error) {
        console.error("   Error Title:", error.response.data.error.title);
        console.error("   Error Message:", error.response.data.error.message);
        console.error("   Request ID:", error.response.data.error.request_id);

        // Log detailed validation errors
        if (
          error.response.data.error.details &&
          Array.isArray(error.response.data.error.details)
        ) {
          console.error("   📋 Validation Details:");
          error.response.data.error.details.forEach((detail, index) => {
            console.error(
              `      ${index + 1}. ${JSON.stringify(detail, null, 6)}`
            );
          });
        }
      }

      // Log the entire response data for complete debugging
      console.error(
        "   🔍 Full Response Data:",
        JSON.stringify(error.response.data, null, 4)
      );
    }
    throw error;
  }
}

/**
 * Get tracking information for a delivery
 * @param {String} trackingNumber - Tracking number
 * @returns {Object} Tracking information
 */
async function getTrackingInfo(trackingNumber) {
  try {
    const token = await ninjaVanAuth.getValidToken();

    // DEBUG: Log token and request info (server-side only)
    console.log("📍 [NINJAVAN] Getting tracking info:", {
      trackingNumber: trackingNumber,
      tokenLength: token ? token.length : 0,
      tokenStart: token ? token.substring(0, 20) + "..." : "No token",
      apiUrl: `${API_BASE_URL}/${COUNTRY_CODE}/2.2/orders/${trackingNumber}/tracking`,
      timestamp: new Date().toISOString(),
    });

    const getTracking = async () => {
      console.log("📤 [NINJAVAN] Making tracking API request...");

      const response = await axios.get(
        `${API_BASE_URL}/${COUNTRY_CODE}/2.2/orders/${trackingNumber}/tracking`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📥 [NINJAVAN] Tracking response received:", {
        status: response.status,
        statusText: response.statusText,
        dataKeys: Object.keys(response.data || {}),
      });

      return response.data;
    };

    return await retryWithBackoff(getTracking);
  } catch (error) {
    console.error(
      "Error fetching tracking info:",
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Generate waybill for a delivery
 */
async function generateWaybill(trackingNumber) {
  try {
    // Check cache first
    if (waybillCache.has(trackingNumber)) {
      console.log("📄 [NINJAVAN] Waybill found in cache:", trackingNumber);
      return waybillCache.get(trackingNumber);
    }

    const token = await ninjaVanAuth.getValidToken();

    // DEBUG: Log token and request info (server-side only)
    console.log("📄 [NINJAVAN] Generating waybill:", {
      trackingNumber: trackingNumber,
      tokenLength: token ? token.length : 0,
      tokenStart: token ? token.substring(0, 20) + "..." : "No token",
      apiUrl: `${API_BASE_URL}/${COUNTRY_CODE}/4.1/orders/${trackingNumber}/waybill`,
      timestamp: new Date().toISOString(),
    });

    const generateWaybillRequest = async () => {
      console.log("📤 [NINJAVAN] Making waybill API request...");

      const response = await axios.post(
        `${API_BASE_URL}/${COUNTRY_CODE}/4.1/orders/${trackingNumber}/waybill`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📥 [NINJAVAN] Waybill response received:", {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers["content-type"],
        dataSize: response.data ? JSON.stringify(response.data).length : 0,
      });

      return response.data;
    };

    const waybill = await retryWithBackoff(generateWaybillRequest);

    // Cache the waybill
    waybillCache.set(trackingNumber, waybill);

    return waybill;
  } catch (error) {
    console.error(
      "Error generating waybill:",
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Cancel a delivery order
 * @param {String} trackingNumber - Tracking number
 * @returns {Object} Cancellation response
 */
async function cancelDelivery(trackingNumber) {
  try {
    const token = await ninjaVanAuth.getValidToken();

    // DEBUG: Log token and request info (server-side only)
    console.log("❌ [NINJAVAN] Cancelling delivery:", {
      trackingNumber: trackingNumber,
      tokenLength: token ? token.length : 0,
      tokenStart: token ? token.substring(0, 20) + "..." : "No token",
      apiUrl: `${API_BASE_URL}/${COUNTRY_CODE}/2.2/orders/${trackingNumber}`,
      timestamp: new Date().toISOString(),
    });

    const cancelOrder = async () => {
      console.log("📤 [NINJAVAN] Making cancel API request...");

      const response = await axios.delete(
        `${API_BASE_URL}/${COUNTRY_CODE}/2.2/orders/${trackingNumber}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📥 [NINJAVAN] Cancel response received:", {
        status: response.status,
        statusText: response.statusText,
        dataKeys: Object.keys(response.data || {}),
      });

      return response.data;
    };

    return await retryWithBackoff(cancelOrder);
  } catch (error) {
    console.error(
      "Error cancelling delivery:",
      error.response?.data || error.message
    );
    throw error;
  }
}

module.exports = {
  createDeliveryOrder,
  getTrackingInfo,
  generateWaybill,
  cancelDelivery,
};
