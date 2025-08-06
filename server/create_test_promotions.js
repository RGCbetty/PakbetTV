const db = require("./config/db");

async function createPromotions() {
  try {
    console.log("Creating test promotions...");

    // Create PISOSHIPPING promotion
    const [result1] = await db.query(`
      INSERT INTO promotions (
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
        description,
        terms_and_conditions
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
        'Get shipping for only ₱1 on orders ₱500 and above',
        'Valid for orders with minimum amount of ₱500. Limited to one use per customer. Cannot be combined with other promotions.'
      )
    `);

    console.log("PISOSHIPPING promotion created with ID:", result1.insertId);

    // Create free shipping promotion
    const [result2] = await db.query(`
      INSERT INTO promotions (
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

    console.log("FREESHIP1000 promotion created with ID:", result2.insertId);
    console.log("Test promotions created successfully!");
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      console.log("Promotions already exist, skipping creation.");
    } else {
      console.error("Error creating promotions:", error);
    }
  } finally {
    process.exit(0);
  }
}

createPromotions();
