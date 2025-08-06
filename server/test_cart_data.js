const db = require("./config/db");

(async () => {
  try {
    console.log("Checking product 31...");
    const [products] = await db.query(
      "SELECT product_id, name, price, discount_percentage, discounted_price FROM products WHERE product_id = 31"
    );
    console.log(
      "Product 31 from database:",
      JSON.stringify(products[0], null, 2)
    );

    console.log("\nChecking cart item for user 13, product 31...");
    const [cartItems] = await db.query(`
      SELECT 
        c.cart_id,
        c.product_id,
        c.quantity,
        p.name AS product_name,
        p.price,
        p.discount_percentage,
        CASE 
          WHEN p.discount_percentage > 0 THEN
            CASE 
              WHEN p.discount_percentage <= 1 THEN
                p.price * (1 - p.discount_percentage)
              ELSE 
                p.price * (1 - p.discount_percentage / 100)
            END
          ELSE 0
        END AS discounted_price
      FROM cart c
      JOIN products p ON c.product_id = p.product_id
      WHERE c.user_id = 13 AND c.product_id = 31
    `);

    if (cartItems.length > 0) {
      console.log(
        "Cart item for user 13, product 31:",
        JSON.stringify(cartItems[0], null, 2)
      );
    } else {
      console.log("No cart items found for user 13, product 31");
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();
