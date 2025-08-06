const crypto = require("crypto");
const axios = require("axios");
const config = require("../config/keys");

class DragonpayService {
  constructor() {
    this.merchantId = config.DRAGONPAY_MERCHANT_ID || "PAKBETTV";
    this.secretKey = config.DRAGONPAY_SECRET_KEY || "test_key";
    this.baseUrl = config.DRAGONPAY_BASE_URL;
    this.apiUrl = config.DRAGONPAY_API_URL;
    this.environment = config.DRAGONPAY_ENV;

    console.log("DragonPay Service initialized with:", {
      environment: this.environment,
      merchantId: this.merchantId,
      baseUrl: this.baseUrl,
      apiUrl: this.apiUrl,
    });
  }

  /**
   * Inquiry a transaction status using Dragonpay Transaction Inquiry API
   * @param {string} txnId - Transaction ID to inquire
   * @returns {Object} Transaction status information
   */
  async inquireTransaction(txnId) {
    try {
      // Create the digest for authentication
      const digestString = `${this.merchantId}:${txnId}:${this.secretKey}`;
      const digest = crypto
        .createHash("sha1")
        .update(digestString)
        .digest("hex");

      // Build the inquiry URL
      const inquiryUrl = `${this.baseUrl}/Query.aspx?merchantid=${this.merchantId}&txnid=${txnId}&digest=${digest}`;

      console.log(`Dragonpay inquiry: ${txnId}`);
      console.log("Inquiry URL:", "[REDACTED]");

      // Make the API call
      const response = await axios.get(inquiryUrl, {
        timeout: 30000, // 30 second timeout
        headers: {
          "User-Agent": "FengShui-ECommerce/1.0",
        },
      });

      // Parse the response
      const responseText = response.data.trim();
      console.log(`Dragonpay response: ${txnId}`);

      return this.parseInquiryResponse(responseText, txnId);
    } catch (error) {
      console.error(`Dragonpay inquiry error: ${txnId}:`, error.message);

      if (error.response) {
        console.error("Response status:", error.response?.status);
        console.error("Response data:", error.response?.data);
      }

      return {
        txnId,
        status: "ERROR",
        message: `API Error: ${error.message}`,
        success: false,
      };
    }
  }

  /**
   * Parse the Dragonpay inquiry response
   * @param {string} responseText - Raw response from Dragonpay
   * @param {string} txnId - Transaction ID for context
   * @returns {Object} Parsed response
   */
  parseInquiryResponse(responseText, txnId) {
    const result = {
      txnId,
      success: false,
      status: "UNKNOWN",
      message: responseText,
    };

    // Handle different response formats from Dragonpay
    if (responseText.includes(":")) {
      // Format: Status:RefNo or Status:RefNo:Message
      const parts = responseText.split(":");
      result.status = parts[0];
      result.refNo = parts[1] || null;
      result.message = parts[2] || responseText;
    } else {
      // Single status response
      result.status = responseText;
    }

    // Determine success based on status
    switch (result.status.toUpperCase()) {
      case "S":
        result.success = true;
        result.message = "Payment successful";
        break;
      case "F":
        result.success = false;
        result.message = "Payment failed";
        break;
      case "P":
        result.success = false;
        result.message = "Payment pending";
        break;
      case "U":
        result.success = false;
        result.message = "Payment status unknown";
        break;
      case "R":
        result.success = false;
        result.message = "Payment refunded";
        break;
      case "K":
        result.success = false;
        result.message = "Payment charged back";
        break;
      case "V":
        result.success = false;
        result.message = "Payment voided";
        break;
      case "A":
        result.success = false;
        result.message = "Payment authorized but not captured";
        break;
      default:
        result.success = false;
        result.message = `Unknown status: ${result.status}`;
    }

    return result;
  }

  /**
   * Map Dragonpay status to internal payment status
   * @param {string} dpStatus - Dragonpay status code
   * @returns {string} Internal payment status
   */
  mapStatusToInternal(dpStatus) {
    switch (dpStatus.toUpperCase()) {
      case "S":
        return "completed";
      case "F":
        return "failed";
      case "P":
        return "waiting_for_confirmation";
      case "U":
        return "unknown";
      case "R":
        return "refunded";
      case "K":
        return "chargeback";
      case "V":
        return "void";
      case "A":
        return "authorized";
      default:
        return "unknown";
    }
  }

  /**
   * Map Dragonpay status to order status
   * @param {string} dpStatus - Dragonpay status code
   * @returns {string} Order status
   */
  mapStatusToOrderStatus(dpStatus) {
    switch (dpStatus.toUpperCase()) {
      case "S":
        return "for_packing";
      case "F":
        return "cancelled";
      case "P":
        return "processing";
      default:
        return "processing";
    }
  }

  /**
   * Map Dragonpay status to order payment status
   * @param {string} dpStatus - Dragonpay status code
   * @returns {string} Order payment status
   */
  mapStatusToOrderPaymentStatus(dpStatus) {
    switch (dpStatus.toUpperCase()) {
      case "S":
        return "paid";
      case "F":
        return "failed";
      case "P":
        return "awaiting_for_confirmation";
      default:
        return "awaiting_for_confirmation";
    }
  }
}

module.exports = new DragonpayService();
