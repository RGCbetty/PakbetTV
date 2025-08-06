const deliveryController = require("../controllers/deliveryController");
const db = require("../config/db");
const {
  sendOrderDispatchedEmail,
  sendReviewRequestEmail,
} = require("../services/emailService");

async function ninjavanWebhook(req, res) {
  try {
    console.log("Received NinjaVan webhook:", req.body);
    if (!req.body || !req.body.event_type) {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    // Use the unified webhook handler from deliveryController
    await deliveryController.ninjavanUnifiedWebhookHandler(req, res);
  } catch (error) {
    console.error("Error processing NinjaVan webhook:", error);
    res.status(200).json({
      status: "error",
      message: "Error processing webhook, but accepted",
    });
  }
}

async function testNinjavanWebhook(req, res) {
  try {
    const { tracking_number, event_type, order_id } = req.body;
    if (!tracking_number || !event_type || !order_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Create a test webhook payload that matches NinjaVan format
    const testPayload = {
      tracking_id: tracking_number,
      event: event_type,
      status: event_type,
      timestamp: new Date().toISOString(),
      description: `Test ${event_type} event`,
      shipper_order_ref_no: `TEST-${order_id}`,
    };

    // Create a mock request object
    const mockReq = {
      body: testPayload,
    };

    // Use the unified webhook handler
    await deliveryController.ninjavanUnifiedWebhookHandler(mockReq, res);
  } catch (error) {
    console.error("Error processing test webhook:", error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  ninjavanWebhook,
  testNinjavanWebhook,
};
