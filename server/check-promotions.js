const db = require("./config/db");

async function checkPromotions() {
  try {
    console.log("=== Current Active Promotions ===");
    const [promotions] = await db.execute(`
      SELECT 
        promotion_id, promotion_code, promotion_name, promotion_type, discount_type, discount_value, 
        shipping_override_amount, free_shipping, minimum_order_amount, is_active, created_at
      FROM promotions 
      WHERE is_active = 1
      ORDER BY created_at DESC
    `);

    promotions.forEach((promo) => {
      console.log(`ID: ${promo.promotion_id}`);
      console.log(`Code: ${promo.promotion_code}`);
      console.log(`Name: ${promo.promotion_name}`);
      console.log(`Type: ${promo.promotion_type}`);
      console.log(`Discount Type: ${promo.discount_type}`);
      console.log(`Discount Value: ${promo.discount_value}`);
      console.log(`Shipping Override: ${promo.shipping_override_amount}`);
      console.log(`Free Shipping: ${promo.free_shipping}`);
      console.log(`Min Order: ${promo.minimum_order_amount}`);
      console.log("---");
    });

    console.log("\n=== Recent Promotion Usage ===");
    const [usage] = await db.execute(`
      SELECT 
        pu.usage_id, pu.promotion_id, pu.user_id, pu.order_id, 
        pu.discount_amount, pu.shipping_discount, pu.used_at, p.promotion_code
      FROM promotion_usage pu
      LEFT JOIN promotions p ON pu.promotion_id = p.promotion_id
      ORDER BY pu.used_at DESC 
      LIMIT 5
    `);

    usage.forEach((use) => {
      console.log(`Usage ID: ${use.usage_id}`);
      console.log(`Promotion Code: ${use.promotion_code}`);
      console.log(`User ID: ${use.user_id}`);
      console.log(`Order ID: ${use.order_id}`);
      console.log(`Discount Applied: ₱${use.discount_amount}`);
      console.log(`Shipping Discount: ₱${use.shipping_discount}`);
      console.log(`Used At: ${use.used_at}`);
      console.log("---");
    });

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkPromotions();
