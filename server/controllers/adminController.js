const db = require("../config/db");
const { createShippingOrder } = require("./deliveryController");
const paymentStatusChecker = require("../services/paymentStatusChecker");

// Manual payment check trigger
const checkPayments = async (req, res) => {
  try {
    console.log("Admin triggered manual payment status check...");

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 10000)
    );

    const checkPromise = paymentStatusChecker.checkPendingPayments();

    try {
      const result = await Promise.race([checkPromise, timeoutPromise]);

      res.json({
        success: true,
        message: "Payment status check completed successfully",
        result: {
          checked: result.checked || 0,
          updated: result.updated || 0,
          errors: result.errors || 0,
          duration: result.duration || 0,
        },
      });
    } catch (timeoutError) {
      res.json({
        success: true,
        message: "Payment status check started in background",
        note: "Check is running, please wait for updates",
      });
    }
  } catch (error) {
    console.error("Error in admin payment check:", error);
    res.status(500).json({
      success: false,
      message: "Failed to trigger payment status check",
      error: error.message,
    });
  }
};

// Alternative payment check endpoint (same functionality, different route)
const paymentsCheck = async (req, res) => {
  return checkPayments(req, res);
};

// Confirm payment and create shipping order
const confirmPayment = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { orderId } = req.params;

    if (!orderId) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    // Get order details
    const [orders] = await connection.query(
      `SELECT o.*, u.first_name, u.last_name, u.email, u.phone
       FROM orders o 
       JOIN users u ON o.user_id = u.user_id
       WHERE o.order_id = ?`,
      [orderId]
    );

    if (orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    // Check if order is in correct status for confirmation
    if (
      order.payment_status !== "awaiting_for_confirmation" &&
      order.payment_status !== "pending"
    ) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Order payment status is '${order.payment_status}'. Only orders with 'awaiting_for_confirmation' or 'pending' status can be confirmed.`,
      });
    }

    // Update order status to for_packing and payment status to paid
    await connection.query(
      "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
      ["for_packing", "paid", orderId]
    );

    // Update payment record
    await connection.query(
      "UPDATE payments SET status = ?, updated_at = NOW() WHERE order_id = ?",
      ["completed", orderId]
    );

    await connection.commit();
    console.log(`Payment confirmed for order ${orderId}`);

    // Create shipping order (this happens outside the transaction)
    let shippingResult = null;
    try {
      shippingResult = await createShippingOrder(orderId);
      console.log(
        `Shipping order created for order ${orderId}:`,
        shippingResult?.tracking_number
      );
    } catch (shippingError) {
      console.error(
        `Failed to create shipping order for order ${orderId}:`,
        shippingError.message
      );
      // Don't fail the payment confirmation if shipping creation fails
    }

    res.json({
      success: true,
      message: "Payment confirmed and shipping order created successfully",
      order: {
        order_id: orderId,
        order_status: "for_packing",
        payment_status: "paid",
        tracking_number: shippingResult?.tracking_number || null,
      },
      shipping: shippingResult,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error confirming payment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to confirm payment",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// Create shipping order manually
const createShipping = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    console.log(`Admin manually creating shipping order for order ${orderId}`);

    const shippingResult = await createShippingOrder(orderId);

    res.json({
      success: true,
      message: "Shipping order created successfully",
      shipping: shippingResult,
      tracking_number: shippingResult?.tracking_number || null,
    });
  } catch (error) {
    console.error("Error creating shipping order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create shipping order",
      error: error.message,
    });
  }
};

module.exports = {
  checkPayments,
  paymentsCheck,
  confirmPayment,
  createShipping,
};
