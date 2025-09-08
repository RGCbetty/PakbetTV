const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const NodeCache = require("node-cache");
const cacheManager = require("../utils/cacheManager");

// Initialize cache with 1 minute TTL for cart (shorter than products since cart changes more frequently)
const cartCache = new NodeCache({ stdTTL: 60 });

// Register cache with cache manager
cacheManager.register("cart", cartCache);

// Add rate limiting
const userOperations = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_OPERATIONS = 30; // 30 operations per minute

const checkRateLimit = (userId) => {
  const now = Date.now();
  const userOps = userOperations.get(userId) || { count: 0, timestamp: now };

  if (now - userOps.timestamp > RATE_LIMIT_WINDOW) {
    userOps.count = 1;
    userOps.timestamp = now;
  } else {
    userOps.count++;
  }

  userOperations.set(userId, userOps);
  return userOps.count <= MAX_OPERATIONS;
};

// Validate cart item
const validateCartItem = (item) => {
  return (
    item &&
    typeof item.product_id === "number" &&
    typeof item.quantity === "number" &&
    item.quantity > 0 &&
    item.quantity <= 100 // Maximum reasonable quantity
  );
};

// Handler for GET /api/cart
async function getCart(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "User authentication failed" });
    }

    // Check rate limit
    if (!checkRateLimit(userId)) {
      return res
        .status(429)
        .json({ message: "Too many cart operations. Please try again later." });
    }

    // Check cache first
    const cacheKey = `cart_${userId}`;
    const cached = cartCache.get(cacheKey);
    if (cached) {
      console.log("Returning cached cart for user:", userId);
      return res.json(cached);
    }

    console.log("Fetching cart for user ID:", userId);

    // Highly optimized cart query with better performance
    const [cartItems] = await db.query(
      `
      SELECT 
        c.cart_id,
        c.product_id,
        c.variant_id,
        c.quantity,
        p.name AS product_name,
        p.product_code,
        p.weight,
        -- Optimized price selection with COALESCE
        COALESCE(pv.price, p.price, 0) AS price,
        
        -- Efficient discount calculation
        p.discount_percentage,
        CASE 
          WHEN p.discount_percentage > 0 THEN
            CASE 
              WHEN p.discount_percentage <= 1 THEN
                COALESCE(pv.price, p.price, 0) * (1 - p.discount_percentage)
              ELSE 
                COALESCE(pv.price, p.price, 0) * (1 - p.discount_percentage / 100)
            END
          ELSE 0
        END AS discounted_price,
        
        -- Optimized stock selection
        COALESCE(pv.stock, p.stock, 0) AS stock,
        
        -- Get image from variant or use fallback to product_images table
        COALESCE(
          pv.image_url,
          (
            SELECT pi.image_url 
            FROM product_images pi 
            WHERE pi.product_id = p.product_id 
            ORDER BY pi.sort_order 
            LIMIT 1
          ),
          '/placeholder-product.jpg'
        ) AS image_url,
        
        -- Variant attributes with safer JSON extraction
        CASE 
          WHEN pv.variant_id IS NOT NULL AND pv.attributes IS NOT NULL THEN
            JSON_UNQUOTE(JSON_EXTRACT(pv.attributes, '$.Size'))
          ELSE NULL
        END AS size,
        CASE 
          WHEN pv.variant_id IS NOT NULL AND pv.attributes IS NOT NULL THEN
            JSON_UNQUOTE(JSON_EXTRACT(pv.attributes, '$.Color'))
          ELSE NULL
        END AS color,
        pv.sku
        
      FROM cart c
      INNER JOIN products p ON c.product_id = p.product_id
      LEFT JOIN product_variants pv ON c.variant_id = pv.variant_id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT 50
    `,
      [userId]
    );

    // Validate and process cart items
    const validatedItems = cartItems.filter((item) => validateCartItem(item));

    console.log(
      `Found ${validatedItems.length} valid cart items for user ${userId}`
    );

    const processedCartItems = validatedItems.map((item) => ({
      ...item,
      price: Number(item.price) || 0,
      discounted_price: Number(item.discounted_price) || 0,
      discount_percentage: Number(item.discount_percentage) || 0,
      stock: Number(item.stock) || 0,
      image_url: item.image_url || "/placeholder-product.jpg",
    }));

    console.log(
      "[CartController] Sending processed cart items:",
      processedCartItems.map((item) => ({
        name: item.product_name,
        price: item.price,
        discount_percentage: item.discount_percentage,
        discounted_price: item.discounted_price,
        quantity: item.quantity,
      }))
    );

    // Cache the results for 2 minutes
    cartCache.set(cacheKey, processedCartItems);

    res.json(processedCartItems);
  } catch (err) {
    console.error("Cart fetch error:", err.message);
    console.error("Stack trace:", err.stack);
    res.status(500).json({ message: "Server error", error: err.message });
  }
}

// Handler for POST /api/cart
async function addToCart(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const userId = req.user?.user?.id || req.user?.id || req.user?.user_id;
  if (!userId) {
    return res.status(401).json({ message: "User authentication failed" });
  }

  // Check rate limit
  if (!checkRateLimit(userId)) {
    return res
      .status(429)
      .json({ message: "Too many cart operations. Please try again later." });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { product_id, quantity, variant_id } = req.body;

    // Validate input
    if (!validateCartItem({ product_id, quantity })) {
      await connection.rollback();
      return res.status(400).json({ message: "Invalid cart item data" });
    }

    // Check total items in cart
    const [cartCount] = await connection.query(
      "SELECT COUNT(*) as count FROM cart WHERE user_id = ?",
      [userId]
    );

    if (cartCount[0].count >= 50) {
      await connection.rollback();
      return res.status(400).json({ message: "Cart item limit reached" });
    }

    // Check stock availability
    let stockQuery = variant_id
      ? "SELECT stock FROM product_variants WHERE variant_id = ?"
      : "SELECT stock FROM products WHERE product_id = ?";
    let stockParams = variant_id ? [variant_id] : [product_id];

    const [stockResult] = await connection.query(stockQuery, stockParams);
    if (!stockResult.length || quantity > stockResult[0].stock) {
      await connection.rollback();
      return res.status(400).json({ message: "Not enough stock available" });
    }

    // Check if item already exists in cart
    const [existingItem] = await connection.query(
      "SELECT cart_id, quantity FROM cart WHERE user_id = ? AND product_id = ? AND (variant_id = ? OR (variant_id IS NULL AND ? IS NULL))",
      [userId, product_id, variant_id, variant_id]
    );

    let result;
    if (existingItem.length > 0) {
      // Check if updated quantity would exceed stock
      const newQuantity = existingItem[0].quantity + quantity;
      if (newQuantity > stockResult[0].stock) {
        await connection.rollback();
        return res.status(400).json({
          message: "Not enough stock available for requested quantity",
        });
      }

      // Update existing item
      result = await connection.query(
        "UPDATE cart SET quantity = quantity + ? WHERE cart_id = ?",
        [quantity, existingItem[0].cart_id]
      );
    } else {
      // Add new item
      result = await connection.query(
        "INSERT INTO cart (user_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)",
        [userId, product_id, variant_id, quantity]
      );
    }

    await connection.commit();

    // Invalidate cache
    cartCache.del(`cart_${userId}`);

    res.json({ message: "Item added to cart successfully" });
  } catch (err) {
    await connection.rollback();
    console.error("Error adding item to cart:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  } finally {
    connection.release();
  }
}

// Handler for PUT /api/cart/:id
async function updateCartItem(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const cartId = req.params.id;
    const userId = req.user?.user?.id || req.user?.id || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: "User authentication failed" });
    }
    const { quantity } = req.body;
    console.log("Updating cart item:", { cartId, userId, quantity });

    // Get cart item with correct stock check based on variant
    const [cartItems] = await db.query(
      `SELECT 
        c.*,
        CASE 
          WHEN c.variant_id IS NOT NULL THEN 
            (SELECT stock FROM product_variants WHERE variant_id = c.variant_id)
          ELSE 
            (SELECT stock FROM products WHERE product_id = c.product_id)
        END AS available_stock
      FROM cart c 
      WHERE c.cart_id = ? AND c.user_id = ?`,
      [cartId, userId]
    );

    if (cartItems.length === 0) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    if (quantity > cartItems[0].available_stock) {
      return res.status(400).json({ message: "Not enough stock available" });
    }

    // Update cart item
    await db.query(
      "UPDATE cart SET quantity = ?, updated_at = NOW() WHERE cart_id = ?",
      [quantity, cartId]
    );

    // Clear user cache after cart update
    cacheManager.clearUserCache(userId, "cart");

    // Invalidate cache
    cartCache.del(`cart_${userId}`);

    console.log("Cart item quantity updated successfully");
    res.json({
      message: "Cart updated successfully",
      item: {
        cart_id: cartId,
        quantity,
      },
    });
  } catch (err) {
    console.error("Cart update error:", err.message);
    console.error("Stack trace:", err.stack);
    res.status(500).json({ message: "Server error", error: err.message });
  }
}

// Handler for DELETE /api/cart/:id
async function deleteCartItem(req, res) {
  try {
    const cartId = req.params.id;
    const userId = req.user?.user?.id || req.user?.id || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: "User authentication failed" });
    }
    console.log("Deleting cart item:", { cartId, userId });
    const [result] = await db.query(
      "DELETE FROM cart WHERE cart_id = ? AND user_id = ?",
      [cartId, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    // Clear user cache after cart deletion
    cacheManager.clearUserCache(userId, "cart");

    console.log("Cart item deleted successfully");
    res.json({ message: "Item removed from cart" });
  } catch (err) {
    console.error("Cart delete error:", err.message);
    console.error("Stack trace:", err.stack);
    res.status(500).json({ message: "Server error", error: err.message });
  }
}

// Handler for DELETE /api/cart
async function clearCart(req, res) {
  try {
    const userId = req.user?.user?.id || req.user?.id || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: "User authentication failed" });
    }
    console.log("Clearing cart for user:", userId);
    await db.query("DELETE FROM cart WHERE user_id = ?", [userId]);
    console.log("Cart cleared successfully");
    res.json({ message: "Cart cleared successfully" });
  } catch (err) {
    console.error("Cart clear error:", err.message);
    console.error("Stack trace:", err.stack);
    res.status(500).json({ message: "Server error", error: err.message });
  }
}

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  deleteCartItem,
  clearCart,
};
