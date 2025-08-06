const db = require("./config/db");

async function addTestPromotions() {
  try {
    console.log("Adding test promotion codes...");

    // Insert PISOSHIPPING promotion
    await db.query(`
      INSERT IGNORE INTO promotions (
        promotion_code,
        promotion_name,
        promotion_type,
        shipping_override_amount,
        minimum_order_amount,
        usage_limit,
        usage_limit_per_user,
        start_date,
        end_date,
        is_active,
        description
      ) VALUES (
        'PISOSHIPPING',
        '1 Peso Shipping Promo',
        'shipping_discount',
        1.00,
        500.00,
        1000,
        1,
        '2024-01-01',
        '2025-12-31',
        TRUE,
        'Get shipping for only ₱1 on orders ₱500 and above'
      )
    `);

    console.log("✅ PISOSHIPPING promotion added!");

    // Insert FREESHIP1000 promotion
    await db.query(`
      INSERT IGNORE INTO promotions (
        promotion_code,
        promotion_name,
        promotion_type,
        free_shipping,
        minimum_order_amount,
        usage_limit_per_user,
        start_date,
        end_date,
        is_active,
        description
      ) VALUES (
        'FREESHIP1000',
        'Free Shipping on ₱1000+',
        'shipping_discount',
        TRUE,
        1000.00,
        1,
        '2024-01-01',
        '2025-12-31',
        TRUE,
        'Free shipping on orders ₱1000 and above'
      )
    `);

    console.log("✅ FREESHIP1000 promotion added!");
    console.log("🎉 Test promotions are ready to use!");
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      console.log("✅ Promotions already exist - ready to use!");
    } else {
      console.error("❌ Error adding promotions:", error);
    }
  } finally {
    process.exit(0);
  }
}

addTestPromotions();
