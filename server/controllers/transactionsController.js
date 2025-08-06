// All logic from transactions.js route handlers should be moved here as named exports.
// Export each handler as a named function, do not change any logic.
// (Insert all route handler logic and helper functions from transactions.js here)

const express = require("express");
const crypto = require("crypto");
const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const deliveryRouter = require("../routes/delivery");
const { sendOrderConfirmationEmail } = require("../services/emailService");
const cacheManager = require("../utils/cacheManager");
const paymentStatusChecker = require("../services/paymentStatusChecker");
const dragonpayService = require("../services/dragonpayService");
const {
  runManualPaymentCheck,
  getPaymentStatusCheckerStatus,
} = require("../cron/paymentStatusChecker");
const { body, validationResult } = require("express-validator");
const axios = require("axios");
const config = require("../config/keys");
const ninjaVanAuth = require("../services/ninjaVanAuth");
const { createShippingOrder } = require("./deliveryController");
const API_BASE_URL = config.NINJAVAN_API_URL || "https://api.ninjavan.co";
const COUNTRY_CODE = config.NINJAVAN_COUNTRY_CODE || "PH";

// Constants
const MERCHANT_ID = config.DRAGONPAY_MERCHANT_ID || "TEST";
const DRAGONPAY_SECRET_KEY = config.DRAGONPAY_SECRET_KEY || "test_key";
const BASE_URL = config.DRAGONPAY_API_URL;

console.log("DragonPay Configuration:", {
  environment: config.DRAGONPAY_ENV,
  merchantId: MERCHANT_ID,
  baseUrl: BASE_URL,
  secretKeyLength: DRAGONPAY_SECRET_KEY ? DRAGONPAY_SECRET_KEY.length : 0,
  secretKeyStartsWith: DRAGONPAY_SECRET_KEY
    ? DRAGONPAY_SECRET_KEY.substring(0, 4) + "..."
    : "undefined",
  clientUrl:
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    "https://michaeldemesa.com",
});

// Helper function to map Dragonpay status to internal status
function mapDragonpayStatus(dpStatus) {
  switch (dpStatus) {
    case "S":
      return "completed";
    case "F":
      return "failed";
    case "P":
      return "pending";
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

// Helper Functions
async function sendOrderConfirmationEmailForIPN(
  order,
  referenceNumber,
  trackingNumber = null
) {
  try {
    // Get order items
    const [orderItems] = await db.query(
      "SELECT oi.*, p.name FROM order_items oi JOIN products p ON oi.product_id = p.product_id WHERE oi.order_id = ?",
      [order.order_id]
    );

    // Get shipping details - this contains the actual customer info from checkout
    const [shippingDetails] = await db.query(
      "SELECT * FROM shipping WHERE order_id = ?",
      [order.order_id]
    );

    // Use shipping data if available, fallback to user data
    const customerName =
      shippingDetails[0]?.name || `${order.first_name} ${order.last_name}`;
    const customerEmail = shippingDetails[0]?.email || order.email;

    const emailDetails = {
      orderNumber: order.order_code || order.order_id,
      customerName: customerName,
      customerEmail: customerEmail,
      items: orderItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: parseFloat(item.price) || 0,
      })),
      totalAmount: order.total_price,
      shippingFee: 0, // Add if you have this info
      shippingAddress: shippingDetails[0]?.address || "Address not available",
      paymentMethod: "DragonPay",
      paymentReference: referenceNumber,
      trackingNumber: trackingNumber,
    };

    await sendOrderConfirmationEmail(emailDetails);
    console.log("IPN - Order confirmation email sent successfully");
  } catch (emailError) {
    console.error(
      "❌ IPN - Failed to send order confirmation email:",
      emailError.message
    );
  }
}

// Main Controller Methods

// Create Order
exports.createOrder = async (req, res) => {
  const connection = await db.getConnection();
  console.log("Starting order creation process...");
  console.log("Database connection acquired");

  try {
    await connection.beginTransaction();
    console.log("Transaction started");

    const {
      user_id,
      total_amount,
      subtotal,
      shipping_fee = 0,
      items,
      shipping_details,
      payment_method,
      voucher_code,
      promo_code,
    } = req.body;

    // Validate required fields
    if (!user_id || !items || !Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Missing required fields: user_id and items array are required",
      });
    }

    // Validate shipping details
    if (
      !shipping_details ||
      !shipping_details.address ||
      !shipping_details.phone
    ) {
      await connection.rollback();
      return res.status(400).json({
        message: "Shipping details are required (address and phone)",
      });
    }

    // Validate phone number - accept more formats
    const cleanPhone = shipping_details?.phone?.replace(/[\s\-\(\)\.]/g, "");
    if (!cleanPhone || !cleanPhone.match(/^(\+?63|0)?[0-9]{10}$/)) {
      await connection.rollback();
      return res.status(400).json({
        message:
          "Invalid phone number format. Please provide a valid phone number (e.g., +63 912 345 6789, 0912-345-6789, or 09123456789)",
      });
    }

    // Format phone to standard format
    const standardPhone = cleanPhone.replace(/^0/, "+63");
    shipping_details.phone = standardPhone;

    // Validate and apply discount if provided (supports both voucher and promotion systems)
    let discountAmount = 0;
    let productDiscount = 0;
    let shippingDiscount = 0;
    let discountId = null;
    let discountType = null;
    let discountSystemUsed = null;
    let finalTotalAmount = total_amount;
    let finalSubtotal = subtotal;
    let finalShippingFee = shipping_fee;

    // Use promotion system for both promo_code and voucher_code (unified approach)
    const discount_code = promo_code || voucher_code;

    if (discount_code) {
      try {
        console.log("Using promotion system for discount code:", discount_code);
        const promotionService = require("../services/promotionService");

        const cartData = {
          items,
          subtotal,
          shipping_fee,
          promo_code: discount_code,
        };

        const promotionResult = await promotionService.applyPromotions(
          cartData,
          user_id
        );

        productDiscount = promotionResult.product_discount || 0;
        shippingDiscount = promotionResult.shipping_discount || 0;
        discountAmount = productDiscount + shippingDiscount;
        finalTotalAmount = promotionResult.final_total;
        finalSubtotal = promotionResult.final_subtotal;
        finalShippingFee = promotionResult.final_shipping;
        discountSystemUsed = "promotion";

        // Get promotion ID from applied promotions
        if (
          promotionResult.applied_promotions &&
          promotionResult.applied_promotions.length > 0
        ) {
          discountId = promotionResult.applied_promotions[0].promotion_id;
        }

        console.log(
          `Promotion applied: Product ₱${productDiscount}, Shipping ₱${shippingDiscount}`
        );
      } catch (discountError) {
        await connection.rollback();
        return res.status(400).json({
          message: `Error processing discount: ${discountError.message}`,
        });
      }
    }

    const orderCode = uuidv4();

    // Set different initial status for COD orders
    const initialOrderStatus =
      payment_method === "cod" ? "for_packing" : "processing";
    const initialPaymentStatus =
      payment_method === "cod" ? "cod_pending" : "pending";

    // Create the order first - without voucher columns since they don't exist in the current schema
    console.log("Attempting to create order with values:", {
      user_id,
      finalTotalAmount,
      subtotal: subtotal || total_amount - shipping_fee,
      shipping_fee,
      initialOrderStatus,
      initialPaymentStatus,
      orderCode,
    });

    const [orderResult] = await connection.query(
      `INSERT INTO orders 
       (user_id, total_price, total_product_price, total_shipping_fee, order_status, payment_status, order_code, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        user_id,
        finalTotalAmount,
        finalSubtotal,
        finalShippingFee,
        initialOrderStatus,
        initialPaymentStatus,
        orderCode,
      ]
    );

    console.log("Order insert result:", orderResult);
    const orderId = orderResult.insertId;

    if (!orderId || orderId === 0) {
      await connection.rollback();
      throw new Error(
        "Failed to create order - no order ID returned from database"
      );
    }

    console.log("Order created with ID:", orderId);

    // Record promotion usage if discount was applied
    if (discountSystemUsed === "promotion" && discountId) {
      console.log("Recording promotion usage...");
      await connection.query(
        `INSERT INTO promotion_usage (
          promotion_id, order_id, user_id, discount_amount, shipping_discount, used_at
        ) VALUES (?, ?, ?, ?, ?, NOW())`,
        [discountId, orderId, user_id, productDiscount, shippingDiscount]
      );

      // Update promotion usage count
      await connection.query(
        "UPDATE promotions SET current_usage_count = current_usage_count + 1 WHERE promotion_id = ?",
        [discountId]
      );

      console.log("Promotion usage recorded");
    }

    // For COD orders, create a payment record
    if (payment_method === "cod") {
      await connection.query(
        `INSERT INTO payments (
          order_id, payment_method, status, amount,
          reference_number, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        [orderId, "cod", "cod_pending", finalTotalAmount, `COD-${orderCode}`]
      );
      console.log("COD payment record created");
    }

    // Always save shipping details to the correct shipping table
    // With AUTO_INCREMENT, we don't need to manually calculate shipping_id
    await connection.query(
      `INSERT INTO shipping (
        order_id, user_id, address, status, phone, email, name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        orderId,
        user_id,
        shipping_details.address,
        "pending",
        shipping_details.phone || null,
        shipping_details.email || null,
        shipping_details.name || null,
      ]
    );
    console.log("Shipping details saved");

    // Also save structured shipping details for NinjaVan integration
    try {
      await connection.query(
        `INSERT INTO shipping_details (
          order_id, country, province, city_municipality, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NOW(), NOW())`,
        [
          orderId,
          "PH", // Default to Philippines
          shipping_details.province || null,
          shipping_details.city || null,
        ]
      );
      console.log("Structured shipping details saved");
    } catch (shippingDetailsError) {
      console.error(
        "Failed to save structured shipping details:",
        shippingDetailsError
      );
      // Don't fail the order if shipping_details insert fails
    }

    // Process order items and update stock
    for (const item of items) {
      console.log("🚀 ~ item:", item);
      try {
        const [orderItemResult] = await connection.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price, variant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
          [
            orderId,
            item.product_id,
            item.quantity,
            item.price,
            item.variant_id || null,
          ]
        );

        if (
          item.variant_attributes &&
          Object.keys(item.variant_attributes).length > 0
        ) {
          await connection.query(
            "UPDATE order_items SET variant_data = ? WHERE order_item_id = ?",
            [JSON.stringify(item.variant_attributes), orderItemResult.insertId]
          );
        }

        // Update stock levels
        if (item.variant_id) {
          const [[variant]] = await connection.query(
            "SELECT stock FROM product_variants WHERE variant_id = ?",
            [item.variant_id]
          );

          if (!variant) {
            throw new Error(
              `Variant details not found for variant ID ${item.variant_id}`
            );
          }

          if (variant.stock < item.quantity) {
            throw new Error(
              `Not enough stock for variant ID ${item.variant_id}. Available: ${variant.stock}`
            );
          }

          await connection.query(
            "UPDATE product_variants SET stock = ? WHERE variant_id = ?",
            [variant.stock - item.quantity, item.variant_id]
          );
        } else {
          const [[product]] = await connection.query(
            "SELECT stock FROM products WHERE product_id = ?",
            [item.product_id]
          );

          if (!product) {
            throw new Error(
              `Product details not found for product ID ${item.product_id}`
            );
          }

          if (product.stock < item.quantity) {
            throw new Error(
              `Not enough stock for product ID ${item.product_id}. Available: ${product.stock}`
            );
          }

          await connection.query(
            "UPDATE products SET stock = ? WHERE product_id = ?",
            [product.stock - item.quantity, item.product_id]
          );
        }
      } catch (itemError) {
        console.log("🚀 ~ itemError:", itemError);
        await connection.rollback();
        return res.status(400).json({
          message: `Error processing order item: ${itemError.message}`,
        });
      }
    }
    console.log("Order items processed and stock updated");

    // For COD orders, create shipping immediately
    if (payment_method === "cod") {
      // First commit the transaction to ensure order is in database
      await connection.commit();
      console.log("Transaction committed for COD order");

      // Clear the user's cart after successful COD order creation
      try {
        await db.query("DELETE FROM cart WHERE user_id = ?", [user_id]);
        console.log("Cart cleared for user after COD order");
      } catch (cartError) {
        console.error(
          "Failed to clear cart after COD order:",
          cartError.message
        );
      }

      try {
        // Now create the shipping order
        const shippingResult = await createShippingOrder(orderId);
        if (shippingResult?.tracking_number) {
          // Get a new connection for updating tracking number
          const updateConn = await db.getConnection();
          try {
            await updateConn.query(
              "UPDATE orders SET tracking_number = ? WHERE order_id = ?",
              [shippingResult.tracking_number, orderId]
            );
            console.log(
              "COD shipping order created with tracking number:",
              shippingResult.tracking_number
            );
          } finally {
            updateConn.release();
          }
        }

        // Send COD order confirmation email
        try {
          const [orderDetails] = await db.query(
            "SELECT o.*, u.email, u.first_name, u.last_name, u.phone FROM orders o " +
              "JOIN users u ON o.user_id = u.user_id WHERE o.order_id = ?",
            [orderId]
          );

          const [orderItems] = await db.query(
            "SELECT oi.*, p.name, p.price FROM order_items oi " +
              "JOIN products p ON oi.product_id = p.product_id WHERE oi.order_id = ?",
            [orderId]
          );

          // Get shipping details from shipping table (contains actual checkout data)
          const [shippingDetails] = await db.query(
            "SELECT * FROM shipping WHERE order_id = ?",
            [orderId]
          );

          // Get user default shipping details as fallback
          const [userShippingDetails] = await db.query(
            "SELECT * FROM user_shipping_details WHERE user_id = ? AND is_default = 1",
            [user_id]
          );

          if (orderDetails.length > 0) {
            // Use shipping table data (from checkout) if available, fallback to user data
            const customerName =
              shippingDetails[0]?.name ||
              `${orderDetails[0].first_name} ${orderDetails[0].last_name}`;
            const customerEmail =
              shippingDetails[0]?.email || orderDetails[0].email;
            const customerPhone =
              shippingDetails[0]?.phone || orderDetails[0].phone || "N/A";

            // Build complete address from shipping details
            let fullAddress = "Address not available";
            if (shippingDetails.length > 0) {
              fullAddress = shippingDetails[0].address;
            } else if (userShippingDetails.length > 0) {
              const addr = userShippingDetails[0];

              // Use detailed address fields if available (newer format)
              if (addr.house_number || addr.building || addr.street_name) {
                const detailedAddressParts = [
                  addr.house_number,
                  addr.building,
                  addr.street_name,
                  addr.barangay,
                  addr.city_municipality,
                  addr.province,
                  addr.postcode,
                  addr.country,
                ].filter(
                  (part) => part && part.trim() !== "" && part !== "null"
                );

                fullAddress = detailedAddressParts.join(", ");
              } else {
                // Fallback to basic address fields
                const addressParts = [
                  addr.address1,
                  addr.address2,
                  addr.city,
                  addr.state || addr.province,
                  addr.postcode,
                  addr.country,
                ].filter(
                  (part) => part && part.trim() !== "" && part !== "null"
                );

                fullAddress = addressParts.join(", ");
              }
            }

            const emailData = {
              orderNumber: orderDetails[0].order_code || orderId,
              customerName: customerName,
              customerEmail: customerEmail,
              customerPhone: customerPhone,
              items: orderItems.map((item) => ({
                name: item.name,
                quantity: item.quantity,
                price: parseFloat(item.price),
              })),
              totalAmount: parseFloat(orderDetails[0].total_price),
              shippingFee: parseFloat(shipping_fee) || 50, // Use the shipping fee from order creation
              discount: 0,
              shippingAddress: fullAddress,
              paymentMethod: "Cash on Delivery",
              paymentReference: `COD-${orderCode}`,
              trackingNumber: shippingResult?.tracking_number || null,
            };

            console.log(
              "📧 Sending COD confirmation email to:",
              emailData.customerEmail
            );
            await sendOrderConfirmationEmail(emailData);
            console.log("✅ COD order confirmation email sent successfully");
          }
        } catch (emailError) {
          console.error(
            "❌ Failed to send COD confirmation email:",
            emailError.message
          );
          // Don't fail the order creation
        }
      } catch (shippingError) {
        console.error(
          "Failed to create shipping order for COD:",
          shippingError.message
        );
        // Don't fail the order creation, just log the error
      }

      // Return success response for COD order
      // Clear user caches after successful COD order creation
      cacheManager.clearUserCache(user_id, "all");

      return res.status(201).json({
        success: true,
        message: "COD order created successfully",
        order: {
          order_id: orderId,
          order_code: orderCode,
          payment_status: initialPaymentStatus,
          order_status: initialOrderStatus,
          final_total: finalTotalAmount,
          product_discount: productDiscount,
          shipping_discount: shippingDiscount,
          total_savings: productDiscount + shippingDiscount,
          discount_system_used: discountSystemUsed,
        },
      });
    }

    // For non-COD orders, commit and return response
    await connection.commit();
    console.log("Transaction committed successfully");

    // Clear user caches after successful order creation
    cacheManager.clearUserCache(user_id, "all");

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: {
        order_id: orderId,
        order_code: orderCode,
        payment_status: initialPaymentStatus,
        order_status: initialOrderStatus,
        final_total: finalTotalAmount,
        product_discount: productDiscount,
        shipping_discount: shippingDiscount,
        total_savings: productDiscount + shippingDiscount,
        discount_system_used: discountSystemUsed,
      },
    });
  } catch (error) {
    console.error("Error in createOrder:", error);
    await connection.rollback();
    return res.status(500).json({
      success: false,
      message: "Error creating order",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// Process Payment
exports.processPayment = async (req, res) => {
  try {
    const { order_id, payment_method, payment_details } = req.body;
    const [orders] = await db.query(
      "SELECT o.*, u.email FROM orders o JOIN users u ON o.user_id = u.user_id WHERE o.order_id = ?",
      [order_id]
    );

    if (orders.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = orders[0];
    const txnId = order.order_code
      ? `order_${order.order_code}_${Date.now()}`
      : `order_${order_id}_${Date.now()}`;

    const [paymentResult] = await db.query(
      "INSERT INTO payments (order_id, user_id, amount, payment_method, status) VALUES (?, ?, ?, ?, ?)",
      [order_id, order.user_id, order.total_price, payment_method, "pending"]
    );

    const paymentId = paymentResult.insertId;

    if (payment_method === "dragonpay") {
      const amount = parseFloat(order.total_price).toFixed(2);
      const description = `Order #${order_id}`;
      const email = payment_details.email || order.email;
      const returnUrl = `${
        process.env.CLIENT_URL ||
        process.env.FRONTEND_URL ||
        "https://michaeldemesa.com"
      }/transaction-complete`;
      const merchantIdUpper = MERCHANT_ID.toUpperCase();
      const digestString =
        merchantIdUpper +
        ":" +
        txnId +
        ":" +
        amount +
        ":PHP:" +
        description +
        ":" +
        email +
        ":" +
        DRAGONPAY_SECRET_KEY;
      console.log(
        "Digest string format (without actual secret key):",
        merchantIdUpper +
          ":" +
          txnId +
          ":" +
          amount +
          ":PHP:" +
          description +
          ":" +
          email +
          ":***"
      );
      const digest = crypto
        .createHash("sha1")
        .update(digestString)
        .digest("hex");
      console.log("Generated SHA1 digest:", digest);
      const payload = {
        merchantid: merchantIdUpper,
        txnid: txnId,
        amount: amount,
        ccy: "PHP",
        description: description,
        email: email,
        param1: order_id.toString(),
        digest: digest,
        returnurl: returnUrl,
        cancelurl: `${
          process.env.CLIENT_URL ||
          process.env.FRONTEND_URL ||
          "https://michaeldemesa.com"
        }/cart`,
      };
      console.log("Dragonpay payload:", payload);
      console.log(
        "Dragonpay payload (stringified):",
        JSON.stringify(payload, null, 2)
      );

      // Build URL manually to ensure proper encoding
      const queryParams = new URLSearchParams();
      queryParams.append("merchantid", merchantIdUpper);
      queryParams.append("txnid", txnId);
      queryParams.append("amount", amount);
      queryParams.append("ccy", "PHP");
      queryParams.append("description", description);
      queryParams.append("email", email);
      queryParams.append("param1", order_id.toString());
      queryParams.append("digest", digest);
      queryParams.append("returnurl", returnUrl);
      queryParams.append(
        "cancelurl",
        `${
          process.env.CLIENT_URL ||
          process.env.FRONTEND_URL ||
          "https://michaeldemesa.com"
        }/cart`
      );

      // Use environment-based Dragonpay URL (sandbox vs production)
      const redirectUrl = `${
        config.DRAGONPAY_BASE_URL
      }/Pay.aspx?${queryParams.toString()}`;
      console.log(`🏦 DragonPay Environment: ${config.DRAGONPAY_ENV}`);
      console.log("Redirecting to Dragonpay URL:", redirectUrl);

      // Test URL accessibility (optional - for debugging)
      try {
        console.log(
          `Testing DragonPay ${config.DRAGONPAY_ENV} URL accessibility...`
        );
        // Note: In production, you might want to remove this test
      } catch (urlTestError) {
        console.warn("DragonPay URL test failed:", urlTestError.message);
      }

      // Store payment URL and reference number for "Continue Payment" functionality
      await db.query(
        "UPDATE payments SET reference_number = ?, payment_url = ? WHERE payment_id = ?",
        [txnId, redirectUrl, paymentId]
      );
      res.json({
        success: true,
        payment_id: paymentId,
        payment_url: redirectUrl,
        reference_number: txnId,
        order_code: order.order_code,
      });
    } else {
      res.status(400).json({ message: "Unsupported payment method" });
    }
  } catch (error) {
    console.error("Payment processing error:", error);
    res
      .status(500)
      .json({ message: error.message || "Failed to process payment" });
  }
};

// Verify Payment
exports.verifyPayment = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { txnId, refNo, status } = req.query;
    console.log("Verifying transaction:", { txnId, refNo, status });

    if (!txnId || !refNo || !status) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
        details: { txnId, refNo, status },
      });
    }

    const orderCodeMatch = txnId.match(/order_(.+?)_\d+$/);
    if (!orderCodeMatch || !orderCodeMatch[1]) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction ID format",
        details: { txnId },
      });
    }

    const orderCode = orderCodeMatch[1];

    try {
      await connection.beginTransaction();

      const [orders] = await connection.query(
        "SELECT * FROM orders WHERE order_code = ?",
        [orderCode]
      );

      if (orders.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];
      const orderId = order.order_id;

      const [shipping] = await connection.query(
        "SELECT * FROM shipping_details WHERE order_id = ?",
        [orderId]
      );

      const [userShippingDetails] = await connection.query(
        `SELECT usd.*, u.first_name, u.last_name, u.email, u.phone
         FROM user_shipping_details usd
         JOIN users u ON usd.user_id = u.user_id
         WHERE usd.user_id = ? AND usd.is_default = 1`,
        [order.user_id]
      );

      if (status === "S") {
        await connection.query(
          "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
          ["for_packing", "paid", orderId]
        );

        await connection.query(
          "UPDATE payments SET status = ?, reference_number = ?, updated_at = NOW() WHERE order_id = ?",
          ["completed", refNo, orderId]
        );

        await connection.query("DELETE FROM cart WHERE user_id = ?", [
          order.user_id,
        ]);
        await connection.commit();

        try {
          const shippingResult = await deliveryRouter.createShippingOrder(
            orderId
          );
          if (shippingResult?.tracking_number) {
            await db.query(
              "UPDATE orders SET tracking_number = ? WHERE order_id = ?",
              [shippingResult.tracking_number, orderId]
            );
          }
        } catch (shippingError) {
          console.error(
            "Failed to create shipping order:",
            shippingError.message
          );
        }

        try {
          await sendOrderConfirmationEmailForIPN(
            order,
            refNo,
            order.tracking_number
          );
        } catch (emailError) {
          console.error(
            "Failed to send confirmation email:",
            emailError.message
          );
        }

        return res.json({
          success: true,
          status: "success",
          message: "Payment successful",
          order: {
            ...order,
            shipping: shipping.length > 0 ? shipping[0] : null,
          },
        });
      } else if (status === "F") {
        // For failed transactions, we'll restore the stock
        const [orderItems] = await connection.query(
          "SELECT * FROM order_items WHERE order_id = ?",
          [orderId]
        );

        // Restore stock for each item
        for (const item of orderItems) {
          if (item.variant_id) {
            await connection.query(
              "UPDATE product_variants SET stock = stock + ? WHERE variant_id = ?",
              [item.quantity, item.variant_id]
            );
          } else {
            await connection.query(
              "UPDATE products SET stock = stock + ? WHERE product_id = ?",
              [item.quantity, item.product_id]
            );
          }
        }

        await connection.query(
          "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
          ["cancelled", "failed", orderId]
        );
        await connection.query(
          "UPDATE payments SET status = ?, reference_number = ?, updated_at = NOW() WHERE order_id = ?",
          ["failed", refNo, orderId]
        );
        await connection.commit();

        return res.json({
          success: false,
          status: "failed",
          message:
            "Payment failed. Please try again or choose a different payment method.",
          order: {
            ...order,
            shipping: shipping.length > 0 ? shipping[0] : null,
          },
        });
      } else {
        await connection.query(
          "UPDATE payments SET status = ?, reference_number = ?, updated_at = NOW() WHERE order_id = ?",
          ["pending", refNo, orderId]
        );
        await connection.commit();

        return res.json({
          success: true,
          status: "pending",
          message: "Payment is pending confirmation",
          order: {
            ...order,
            shipping: shipping.length > 0 ? shipping[0] : null,
          },
        });
      }
    } catch (error) {
      await connection.rollback();
      console.error("Error during payment verification:", error);
      return res.status(500).json({
        success: false,
        message: "An error occurred while verifying the payment",
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error in payment verification:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while verifying the payment",
    });
  }
};

// Handle Dragonpay Postback
exports.handlePostback = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { txnid, refno, status, message, digest } = req.body;

    console.log("=== Dragonpay IPN (Postback) Received ===");
    console.log(`Transaction ID: ${txnid}`);
    console.log(`Reference Number: ${refno}`);
    console.log(`Status: ${status}`);
    console.log(`Message: ${message}`);

    const orderCodeMatch = txnid.match(/order_(.+?)_\d+$/);
    if (!orderCodeMatch || !orderCodeMatch[1]) {
      return res.status(400).send("result=Invalid transaction ID format");
    }

    const orderCode = orderCodeMatch[1];

    // Validate the digest if provided (security measure)
    if (digest) {
      const expectedDigest = crypto
        .createHash("sha1")
        .update(
          `${txnid}:${refno}:${status}:${message}:${DRAGONPAY_SECRET_KEY}`
        )
        .digest("hex");

      if (digest !== expectedDigest) {
        console.error(
          "❌ IPN digest validation failed - possible security issue"
        );
        return res.status(400).send("result=Invalid digest");
      }
      console.log("IPN digest validated successfully");
    }

    try {
      await connection.beginTransaction();

      const [orders] = await connection.query(
        "SELECT o.*, u.first_name, u.last_name, u.email FROM orders o " +
          "JOIN users u ON o.user_id = u.user_id " +
          "WHERE o.order_code = ?",
        [orderCode]
      );

      if (orders.length === 0) {
        await connection.rollback();
        return res.status(400).send("result=Order not found");
      }

      const order = orders[0];
      const orderId = order.order_id;

      if (status === "S") {
        await connection.query(
          "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
          ["for_packing", "paid", orderId]
        );

        await connection.query(
          "UPDATE payments SET status = ?, reference_number = ?, transaction_id = ?, updated_at = NOW() WHERE order_id = ?",
          ["completed", refno, txnid, orderId]
        );

        await connection.query("DELETE FROM cart WHERE user_id = ?", [
          order.user_id,
        ]);
        await connection.commit();

        try {
          const shippingResult = await deliveryRouter.createShippingOrder(
            orderId
          );
          if (shippingResult?.tracking_number) {
            await db.query(
              "UPDATE orders SET tracking_number = ? WHERE order_id = ?",
              [shippingResult.tracking_number, orderId]
            );
          }
          await sendOrderConfirmationEmailForIPN(
            order,
            refno,
            shippingResult?.tracking_number
          );
        } catch (error) {
          console.error("Error in post-payment processing:", error);
        }
      } else if (status === "F") {
        await connection.query(
          "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
          ["cancelled", "failed", orderId]
        );

        await connection.query(
          "UPDATE payments SET status = ?, reference_number = ?, transaction_id = ?, updated_at = NOW() WHERE order_id = ?",
          ["failed", refno, txnid, orderId]
        );

        await connection.commit();
      } else if (status === "P") {
        await connection.query(
          "UPDATE orders SET order_status = ?, payment_status = ?, updated_at = NOW() WHERE order_id = ?",
          ["processing", "awaiting_for_confirmation", orderId]
        );

        await connection.query(
          "UPDATE payments SET status = ?, reference_number = ?, transaction_id = ?, updated_at = NOW() WHERE order_id = ?",
          ["waiting_for_confirmation", refno, txnid, orderId]
        );

        await connection.commit();
      } else {
        await connection.query(
          "UPDATE payments SET status = ?, reference_number = ?, transaction_id = ?, updated_at = NOW() WHERE order_id = ?",
          [mapDragonpayStatus(status), refno, txnid, orderId]
        );

        await connection.commit();
      }

      res.status(200).send("result=OK");
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("❌ IPN processing error:", error);
    res.status(500).send("result=Error processing payment notification");
  }
};

// Utility Endpoints

// Simulate payment (for testing)
exports.simulatePayment = async (req, res) => {
  try {
    const { orderId, status = "S" } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    console.log(
      `Simulating payment for order ${orderId} with status ${status}`
    );

    const [orders] = await db.query("SELECT * FROM orders WHERE order_id = ?", [
      orderId,
    ]);

    if (orders.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const txnid = `order_${orderId}_${Date.now()}`;
    const refno = `REF-${orderId}-${Date.now()}`;
    const transactionId = `TXN-${orderId}-${Date.now()}`;

    const [payments] = await db.query(
      "SELECT * FROM payments WHERE order_id = ?",
      [orderId]
    );

    if (payments.length > 0) {
      await db.query(
        "UPDATE payments SET status = ?, reference_number = ?, transaction_id = ? WHERE order_id = ?",
        [mapDragonpayStatus(status), refno, transactionId, orderId]
      );
    } else {
      await db.query(
        "INSERT INTO payments (order_id, user_id, amount, payment_method, status, reference_number, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          orderId,
          orders[0].user_id,
          orders[0].total_price,
          "dragonpay",
          mapDragonpayStatus(status),
          refno,
          transactionId,
        ]
      );
    }

    if (status === "S") {
      await db.query(
        "UPDATE orders SET order_status = ?, payment_status = ? WHERE order_id = ?",
        ["for_packing", "paid", orderId]
      );

      try {
        const [userDetails] = await db.query(
          "SELECT u.first_name, u.last_name, u.email, u.phone FROM users u WHERE u.user_id = ?",
          [orders[0].user_id]
        );

        const [orderItems] = await db.query(
          "SELECT oi.*, p.name FROM order_items oi JOIN products p ON oi.product_id = p.product_id WHERE oi.order_id = ?",
          [orderId]
        );

        const [shippingDetails] = await db.query(
          "SELECT * FROM shipping WHERE order_id = ?",
          [orderId]
        );
        const [userShippingDetails] = await db.query(
          "SELECT * FROM user_shipping_details WHERE user_id = ? AND is_default = 1",
          [orders[0].user_id]
        );

        let shippingAddress = "Address not available";
        if (shippingDetails.length > 0 && shippingDetails[0].address) {
          shippingAddress = shippingDetails[0].address;
        } else if (userShippingDetails.length > 0) {
          const userShipping = userShippingDetails[0];
          shippingAddress = `${userShipping.address1}, ${
            userShipping.address2 || ""
          }, ${userShipping.city}, ${userShipping.state}, ${
            userShipping.postcode
          }, ${userShipping.country}`
            .trim()
            .replace(/, ,/g, ",")
            .replace(/,$/g, "");
        }

        if (userDetails.length > 0) {
          const user = userDetails[0];
          const emailDetails = {
            orderNumber: orders[0].order_code || orderId,
            customerName: `${user.first_name} ${user.last_name}`,
            customerEmail: user.email,
            customerPhone: user.phone,
            items: orderItems.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              price: parseFloat(item.price) || 0,
            })),
            totalAmount: orders[0].total_price,
            shippingFee: 0,
            shippingAddress: shippingAddress,
            paymentMethod: "DragonPay (Simulated)",
            paymentReference: refno,
            trackingNumber: orders[0].tracking_number || null,
          };

          await sendOrderConfirmationEmail(emailDetails);
        }
      } catch (emailError) {
        console.error("Failed to send confirmation email:", emailError.message);
      }

      try {
        const shippingResult = await deliveryRouter.createShippingOrder(
          orderId
        );
        return res.status(200).json({
          message: "Payment simulation successful and shipping order created",
          order_status: "for_packing",
          payment_status: "paid",
          transaction_id: transactionId,
          reference_number: refno,
          shipping: shippingResult,
        });
      } catch (shippingError) {
        return res.status(200).json({
          message:
            "Payment simulation successful but shipping order creation failed",
          order_status: "for_packing",
          payment_status: "paid",
          transaction_id: transactionId,
          reference_number: refno,
          error: shippingError.message,
        });
      }
    } else if (status === "F") {
      await db.query("UPDATE orders SET order_status = ? WHERE order_id = ?", [
        "cancelled",
        orderId,
      ]);

      return res.status(200).json({
        message: "Payment simulation: Failed payment",
        order_status: "cancelled",
        payment_status: "failed",
        transaction_id: transactionId,
        reference_number: refno,
      });
    } else if (status === "P") {
      await db.query("UPDATE orders SET order_status = ? WHERE order_id = ?", [
        "pending",
        orderId,
      ]);

      return res.status(200).json({
        message: "Payment simulation: Pending payment",
        order_status: "pending",
        payment_status: "pending",
        transaction_id: transactionId,
        reference_number: refno,
      });
    }

    return res.status(200).json({
      message: `Payment simulation with status: ${status}`,
      order_status: orders[0].order_status,
      payment_status: mapDragonpayStatus(status),
      transaction_id: transactionId,
      reference_number: refno,
    });
  } catch (error) {
    console.error("Payment simulation error:", error);
    res.status(500).json({
      message: "Failed to simulate payment",
      error: error.message,
    });
  }
};

// Prepare order for confirmation
exports.prepareForConfirmation = async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    const [orders] = await db.query("SELECT * FROM orders WHERE order_id = ?", [
      orderId,
    ]);

    if (orders.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    await db.query(
      "UPDATE orders SET order_status = ?, payment_status = ? WHERE order_id = ?",
      ["processing", "awaiting_for_confirmation", orderId]
    );

    const [payments] = await db.query(
      "SELECT * FROM payments WHERE order_id = ?",
      [orderId]
    );

    if (payments.length > 0) {
      await db.query("UPDATE payments SET status = ? WHERE order_id = ?", [
        "waiting_for_confirmation",
        orderId,
      ]);
    } else {
      await db.query(
        "INSERT INTO payments (order_id, user_id, amount, payment_method, status) VALUES (?, ?, ?, ?, ?)",
        [
          orderId,
          orders[0].user_id,
          orders[0].total_price,
          "dragonpay",
          "waiting_for_confirmation",
        ]
      );
    }

    res.status(200).json({
      message: "Order prepared for admin confirmation",
      order_id: orderId,
      status: "processing",
      payment_status: "awaiting_for_confirmation",
    });
  } catch (error) {
    console.error("Error preparing order for confirmation:", error);
    res.status(500).json({
      message: "Failed to prepare order",
      error: error.message,
    });
  }
};

// Test postback endpoint
exports.testPostback = (req, res) => {
  console.log("Test postback received:", req.body);
  console.log("Headers:", req.headers);
  console.log("IP:", req.ip);
  res.status(200).send("result=OK");
};

// Test GET postback endpoint
exports.testGetPostback = (req, res) => {
  console.log("Test GET postback received:", req.query);
  console.log("Headers:", req.headers);
  console.log("IP:", req.ip);

  res.status(200).json({
    message: "Postback URL is accessible",
    timestamp: new Date().toISOString(),
    received_data: {
      query: req.query,
      headers: req.headers,
      ip: req.ip,
    },
  });
};

// Payment Status Checker Endpoints
exports.checkPaymentStatus = async (req, res) => {
  try {
    console.log("Manual payment status check triggered");
    const result = await runManualPaymentCheck();

    res.json({
      success: true,
      message: "Payment status check completed",
      result: result,
    });
  } catch (error) {
    console.error("Error in manual payment status check:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check payment status",
      error: error.message,
    });
  }
};

exports.triggerPaymentCheck = async (req, res) => {
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 5000)
    );

    const checkPromise = runManualPaymentCheck();

    try {
      const result = await Promise.race([checkPromise, timeoutPromise]);

      res.json({
        success: true,
        message: "Payment status check triggered successfully",
        checked: result.checked || 0,
        updated: result.updated || 0,
      });
    } catch (timeoutError) {
      res.json({
        success: true,
        message: "Payment status check started in background",
        note: "Check is running, please wait for updates",
      });
    }
  } catch (error) {
    console.error("Error triggering payment status check:", error);
    res.status(500).json({
      success: false,
      message: "Failed to trigger payment status check",
      error: error.message,
    });
  }
};

exports.getPaymentCheckerStatus = (req, res) => {
  try {
    const status = getPaymentStatusCheckerStatus();
    res.json({
      success: true,
      status: status,
    });
  } catch (error) {
    console.error("Error getting payment checker status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get payment checker status",
      error: error.message,
    });
  }
};

exports.inquireTransaction = async (req, res) => {
  try {
    const { txnId } = req.params;

    if (!txnId) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required",
      });
    }

    console.log(`Manual inquiry for transaction: ${txnId}`);
    const result = await dragonpayService.inquireTransaction(txnId);

    res.json({
      success: true,
      message: "Transaction inquiry completed",
      inquiry: result,
    });
  } catch (error) {
    console.error("Error in transaction inquiry:", error);
    res.status(500).json({
      success: false,
      message: "Failed to inquiry transaction",
      error: error.message,
    });
  }
};

exports.getPendingPayments = async (req, res) => {
  try {
    const [pendingPayments] = await db.query(`
      SELECT 
        o.order_id,
        o.order_code,
        o.order_status,
        o.payment_status,
        o.total_price,
        p.payment_id,
        p.reference_number,
        p.status as payment_status_detail,
        p.created_at as payment_created,
        u.first_name,
        u.last_name,
        u.email,
        TIMESTAMPDIFF(HOUR, p.created_at, NOW()) as hours_since_payment
      FROM orders o
      JOIN payments p ON o.order_id = p.order_id
      JOIN users u ON o.user_id = u.user_id
      WHERE o.payment_status = 'awaiting_for_confirmation'
        AND p.reference_number IS NOT NULL
        AND p.reference_number != ''
        AND p.status = 'waiting_for_confirmation'
        AND p.created_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
      ORDER BY p.created_at DESC
    `);

    res.json({
      success: true,
      count: pendingPayments.length,
      payments: pendingPayments,
    });
  } catch (error) {
    console.error("Error getting pending payments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get pending payments",
      error: error.message,
    });
  }
};

// Get payment URL for incomplete orders - for "Continue Payment" functionality
exports.getPaymentUrl = async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get payment details with order verification
    const [payments] = await db.query(
      `
      SELECT 
        p.payment_url,
        p.reference_number,
        p.status as payment_status,
        o.order_status,
        o.payment_status as order_payment_status,
        o.user_id,
        TIMESTAMPDIFF(HOUR, p.created_at, NOW()) as hours_since_created
      FROM payments p
      JOIN orders o ON p.order_id = o.order_id
      WHERE p.order_id = ? AND o.user_id = ?
      ORDER BY p.created_at DESC
      LIMIT 1
    `,
      [orderId, userId]
    );

    if (payments.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found for this order",
      });
    }

    const payment = payments[0];

    // Check if payment URL is available and order is in correct state
    if (!payment.payment_url) {
      return res.status(400).json({
        success: false,
        message: "No payment URL available for this order",
      });
    }

    // Check if order is still within payment window (3 hours)
    if (payment.hours_since_created >= 3) {
      return res.status(400).json({
        success: false,
        message: "Payment window has expired. Please place a new order.",
        expired: true,
      });
    }

    // Check if payment is still pending/incomplete
    const validStatuses = [
      "pending",
      "waiting_for_confirmation",
      "awaiting_for_confirmation",
    ];
    if (
      !validStatuses.includes(payment.payment_status) &&
      !validStatuses.includes(payment.order_payment_status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment has already been processed",
        completed: true,
      });
    }

    // Update order status to 'processing' when user accesses payment URL
    // This indicates payment was initiated but user may have gone back
    if (
      payment.order_status === "pending" ||
      payment.order_status === "pending_payment"
    ) {
      await db.query(
        "UPDATE orders SET order_status = ?, updated_at = NOW() WHERE order_id = ?",
        ["processing", orderId]
      );
    }

    res.json({
      success: true,
      payment_url: payment.payment_url,
      reference_number: payment.reference_number,
      hours_remaining: Math.max(0, 3 - payment.hours_since_created),
      message: "Payment URL retrieved successfully",
    });
  } catch (error) {
    console.error("Error getting payment URL:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payment URL",
      error: error.message,
    });
  }
};
