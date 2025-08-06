const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const { promisify } = require("util");
const mkdirp = promisify(require("mkdirp"));
const NodeCache = require("node-cache");
const { auth, admin } = require("../middleware/auth");

// Initialize cache with 5 minute TTL
const productCache = new NodeCache({ stdTTL: 300 });

// Helper function to generate image URLs
const getImageUrl = (rawImg, productId) => {
  if (!rawImg) return null;

  if (Buffer.isBuffer(rawImg)) {
    // Use dedicated image endpoint instead of base64
    return `/api/products/image/${productId}`;
  }

  // Ensure single leading /uploads/ prefix
  if (rawImg.startsWith("/")) {
    return rawImg;
  } else if (rawImg.startsWith("uploads/")) {
    return `/${rawImg}`;
  } else {
    return `/uploads/${rawImg}`;
  }
};

// Helper function to process product images
const processProductImages = async (products, includeImages = true) => {
  if (!includeImages || !products.length) {
    products.forEach((product) => {
      product.images = [];
    });
    return;
  }

  const productIds = products.map((p) => p.product_id);
  let imageMap = {};

  // Get product images with additional fields
  const [imgRows] = await db.query(
    `SELECT DISTINCT pi.product_id, pi.image_id, pi.image_url, 
            COALESCE(pi.sort_order, 0) as sort_order, 
            COALESCE(pi.alt_text, '') as alt_text
     FROM product_images pi
     WHERE pi.product_id IN (?)
     ORDER BY pi.product_id, pi.sort_order`,
    [productIds]
  );

  // Group images by product_id, ensuring no duplicates
  const seenImages = new Set(); // Track unique image URLs per product
  for (const row of imgRows) {
    const imageKey = `${row.product_id}-${row.image_url}`; // Unique key per product-image combination

    // Skip if we've seen this image for this product
    if (seenImages.has(imageKey)) continue;
    seenImages.add(imageKey);

    if (!imageMap[row.product_id]) {
      imageMap[row.product_id] = [];
    }

    // Only add if we have a valid image_id and image_url
    if (row.image_url) {
      imageMap[row.product_id].push({
        id: row.image_id || 0, // Ensure we never send null
        url: row.image_url,
        order: row.sort_order || 0,
        alt: row.alt_text || "",
      });
    }
  }

  // Get variant images for products without main images
  const missingIds = productIds.filter(
    (id) => !imageMap[id] || imageMap[id].length === 0
  );
  if (missingIds.length) {
    const [variantRows] = await db.query(
      `SELECT DISTINCT pv.product_id, pv.variant_id as image_id, pv.image_url
       FROM product_variants pv
       WHERE pv.product_id IN (?) 
       AND pv.image_url IS NOT NULL
       ORDER BY pv.product_id`,
      [missingIds]
    );

    // Track seen variant images to prevent duplicates
    const seenVariantImages = new Set();

    for (const row of variantRows) {
      const imageKey = `${row.product_id}-${row.image_url}`;

      // Skip if we've seen this variant image
      if (seenVariantImages.has(imageKey)) continue;
      seenVariantImages.add(imageKey);

      if (!imageMap[row.product_id]) {
        imageMap[row.product_id] = [];
      }

      if (row.image_url) {
        imageMap[row.product_id].push({
          id: row.image_id || 0,
          url: row.image_url,
          order: 0, // Default order for variant images
          alt: "", // No alt text for variant images
        });
      }
    }
  }

  // Process images for each product
  products.forEach((product) => {
    const images = imageMap[product.product_id] || [];

    // Sort images by order and ensure no duplicates
    const uniqueImages = new Map();
    images.forEach((img) => {
      const key = `${img.url}`; // Use URL as unique key
      if (!uniqueImages.has(key)) {
        uniqueImages.set(key, {
          id: img.id || 0,
          url: getImageUrl(img.url, product.product_id),
          alt: img.alt || product.name,
          order: img.order || 0,
        });
      }
    });

    // Convert to array and sort by order
    product.images = Array.from(uniqueImages.values()).sort(
      (a, b) => a.order - b.order
    );

    // If no images found, ensure empty array
    if (!product.images.length) {
      product.images = [];
    }
  });
};

const ensureDir = async (dir) => {
  try {
    if (!fs.existsSync(dir)) {
      console.log(`Creating directory: ${dir}`);
      await mkdirp(dir);
    }
    return true;
  } catch (err) {
    console.error(`Error creating directory ${dir}:`, err);
    throw err;
  }
};
const productStorage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads/products");
    await ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "product-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const variantStorage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads/variants");
    await ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "variant-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only images are allowed!"), false);
  }
};
const uploadProductImages = multer({
  storage: productStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});
const uploadVariantImages = multer({
  storage: variantStorage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
});
const upload = multer({
  storage: multer.diskStorage({
    destination: async function (req, file, cb) {
      try {
        let uploadDir;
        if (file.fieldname === "productImages") {
          uploadDir = path.join(__dirname, "../uploads/products");
        } else if (file.fieldname === "variantImages") {
          uploadDir = path.join(__dirname, "../uploads/variants");
        } else {
          uploadDir = path.join(__dirname, "../uploads");
        }
        await ensureDir(uploadDir);
        cb(null, uploadDir);
      } catch (error) {
        console.error("Error creating upload directory:", error);
        cb(error);
      }
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const prefix =
        file.fieldname === "productImages"
          ? "product-"
          : file.fieldname === "variantImages"
          ? "variant-"
          : "";
      cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
    },
  }),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: "productImages", maxCount: 10 },
  { name: "variantImages", maxCount: 20 },
]);
const handleCombinedUpload = async (req, res, next) => {
  console.log("Starting file upload processing...");
  upload(req, res, async function (err) {
    if (err) {
      console.error("Multer upload error:", err);
      return res
        .status(400)
        .json({ message: "File upload error: " + err.message });
    }
    try {
      console.log(
        "Files received:",
        req.files ? Object.keys(req.files) : "None"
      );
      if (req.files && req.files.productImages) {
        console.log(
          `Processing ${req.files.productImages.length} product images`
        );
        req.productImages = req.files.productImages.map((file) => {
          const relativePath = "uploads/" + path.basename(file.path);
          return {
            filename: file.filename,
            path: file.path,
            url: relativePath,
          };
        });
      } else {
        req.productImages = [];
      }
      if (req.files && req.files.variantImages) {
        console.log(
          `Processing ${req.files.variantImages.length} variant images`
        );
        req.variantImages = req.files.variantImages.map((file) => {
          const relativePath = "uploads/" + path.basename(file.path);
          return {
            filename: file.filename,
            path: file.path,
            url: relativePath,
          };
        });
      } else {
        req.variantImages = [];
      }
      next();
    } catch (error) {
      console.error("Error processing uploads:", error);
      return res.status(500).json({ message: "Error processing uploads" });
    }
  });
};

// Handler for POST /api/products (create product)
async function createProduct(req, res) {
  // ...migrated as-is from the route file
  // (Insert the full logic from the POST / route handler here)
}

// Handler for GET /api/products/flash-deals (get flash deals)
async function getFlashDeals(req, res) {
  try {
    const limit = 12; // Limit to 12 flash deals

    // Updated SQL for flash deals with consistent stock calculation
    let sql = `
      SELECT
        p.product_id,
        p.name,
        p.product_code,
        p.description,
        p.category_id,
        p.created_at,
        p.updated_at,
        p.is_featured,
        p.price                        AS base_price,
        p.discounted_price,
        p.discount_percentage,
        p.average_rating,
        p.review_count,
        c.name                          AS category_name,
        p.stock as base_stock,
        COALESCE(
          (SELECT SUM(stock) FROM product_variants WHERE product_id = p.product_id),
          p.stock,
          0
        ) AS stock,
        EXISTS (SELECT 1 FROM product_variants WHERE product_id = p.product_id) as has_variants
      FROM products p
      LEFT JOIN categories c     ON p.category_id = c.category_id
      WHERE COALESCE(
        (SELECT SUM(stock) FROM product_variants WHERE product_id = p.product_id),
        p.stock,
        0
      ) > 0
      AND p.discounted_price > 0
      AND p.discount_percentage > 0
      ORDER BY p.discount_percentage DESC, p.created_at DESC
      LIMIT ?`;

    const params = [limit];

    const [productsResult] = await db.query(sql, params);
    let products = productsResult;

    // Add debug logging for flash deals
    console.log("Flash deals found:", products.length);

    // Process numeric fields
    for (const product of products) {
      product.price = Number(product.base_price) || 0;
      product.discounted_price = Number(product.discounted_price) || 0;
      product.discount_percentage = Number(product.discount_percentage) || 0;
      product.average_rating =
        product.average_rating !== null ? Number(product.average_rating) : 0;
      product.review_count = Number(product.review_count) || 0;
      product.stock = Number(product.stock) || 0;
      delete product.base_price;
      product.variants = [];
    }

    // Process images
    const includeImages =
      req.query.includeImages !== "false" && req.query.includeImages !== "0";
    await processProductImages(products, includeImages);

    return res.json(products);
  } catch (err) {
    console.error("Error in flash deals route:", err);
    return res
      .status(500)
      .json({ message: "Server error while fetching flash deals" });
  }
}

// Handler for GET /api/products/new-arrivals (get new arrivals)
async function getNewArrivals(req, res) {
  try {
    const limit = 12; // Limit to 12 new arrivals
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Updated SQL for new arrivals with consistent stock calculation
    let sql = `
      SELECT
        p.product_id,
        p.name,
        p.product_code,
        p.description,
        p.category_id,
        p.created_at,
        p.updated_at,
        p.is_featured,
        p.price                        AS base_price,
        p.discounted_price,
        p.discount_percentage,
        p.average_rating,
        p.review_count,
        c.name                          AS category_name,
        p.stock as base_stock,
        COALESCE(
          (SELECT SUM(stock) FROM product_variants WHERE product_id = p.product_id),
          p.stock,
          0
        ) AS stock,
        EXISTS (SELECT 1 FROM product_variants WHERE product_id = p.product_id) as has_variants
      FROM products p
      LEFT JOIN categories c     ON p.category_id = c.category_id
      WHERE COALESCE(
        (SELECT SUM(stock) FROM product_variants WHERE product_id = p.product_id),
        p.stock,
        0
      ) > 0
      AND p.created_at >= ?
      ORDER BY p.created_at DESC
      LIMIT ?`;

    const params = [thirtyDaysAgo, limit];

    const [productsResult] = await db.query(sql, params);
    let products = productsResult;

    // Add debug logging for new arrivals
    console.log("New arrivals found:", products.length);

    // Process numeric fields
    for (const product of products) {
      product.price = Number(product.base_price) || 0;
      product.discounted_price = Number(product.discounted_price) || 0;
      product.discount_percentage = Number(product.discount_percentage) || 0;
      product.average_rating =
        product.average_rating !== null ? Number(product.average_rating) : 0;
      product.review_count = Number(product.review_count) || 0;
      product.stock = Number(product.stock) || 0;
      delete product.base_price;
      product.variants = [];
    }

    // Process images
    const includeImages =
      req.query.includeImages !== "false" && req.query.includeImages !== "0";
    await processProductImages(products, includeImages);

    return res.json(products);
  } catch (err) {
    console.error("Error in new arrivals route:", err);
    return res
      .status(500)
      .json({ message: "Server error while fetching new arrivals" });
  }
}

// Handler for GET /api/products (get products list)
async function getProducts(req, res) {
  try {
    // Remove pagination completely - load all products
    const category = req.query.category || null;

    // ----- Build SQL without limits -----
    let sql = `
      SELECT
        p.product_id,
        p.name,
        p.product_code,
        p.description,
        p.category_id,
        p.created_at,
        p.updated_at,
        p.is_featured,
        p.price                        AS base_price,
        p.discounted_price,
        p.discount_percentage,
        p.average_rating,
        p.review_count,
        c.name                          AS category_name,
        p.stock as base_stock,
        COALESCE(
          (SELECT SUM(stock) FROM product_variants WHERE product_id = p.product_id),
          p.stock,
          0
        ) AS stock,
        EXISTS (SELECT 1 FROM product_variants WHERE product_id = p.product_id) as has_variants
      FROM products p
      LEFT JOIN categories c     ON p.category_id = c.category_id
      WHERE 1 = 1
      AND COALESCE(
        (SELECT SUM(stock) FROM product_variants WHERE product_id = p.product_id),
        p.stock,
        0
      ) > 0`;

    const params = [];

    if (category) {
      sql += " AND p.category_id = ?";
      params.push(category);
    }

    sql += `
      GROUP BY p.product_id, p.name, p.product_code, p.description, p.category_id,
               p.created_at, p.updated_at, c.name, p.price, p.is_featured
      ORDER BY p.created_at DESC, p.product_id DESC`;

    const [productsResult] = await db.query(sql, params);
    let products = productsResult;

    console.log("All products loaded:", products.length);

    // Process numeric fields
    for (const product of products) {
      product.price = Number(product.base_price) || 0;
      product.discounted_price = Number(product.discounted_price) || 0;
      product.discount_percentage = Number(product.discount_percentage) || 0;
      product.average_rating =
        product.average_rating !== null ? Number(product.average_rating) : 0;
      product.review_count = Number(product.review_count) || 0;
      product.stock = Number(product.stock) || 0;
      delete product.base_price;
      product.variants = [];
    }

    // Process images
    const includeImages =
      req.query.includeImages !== "false" && req.query.includeImages !== "0";
    await processProductImages(products, includeImages);

    // Return simple array structure instead of pagination object
    return res.json({ products });
  } catch (err) {
    console.error("Error in products route:", err);
    return res
      .status(500)
      .json({ message: "Server error while fetching products" });
  }
}

// Handler for GET /api/products/search
async function searchProducts(req, res) {
  try {
    const searchQuery = req.query.query;
    console.log("Product search query received:", searchQuery);

    if (!searchQuery || !searchQuery.trim()) {
      console.log("Empty product search query, returning empty results");
      return res.json([]);
    }

    const searchTerm = `%${searchQuery.toLowerCase()}%`;

    // Simplified query to avoid JOIN issues
    const sqlQuery = `
      SELECT 
        p.product_id,
        p.name,
        p.description,
        p.product_code,
        p.price,
        p.stock,
        p.category_id,
        p.average_rating,
        p.review_count,
        c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.category_id
      WHERE 
        LOWER(p.name) LIKE ? OR
        LOWER(COALESCE(p.description, '')) LIKE ? OR
        LOWER(COALESCE(p.product_code, '')) LIKE ? OR
        LOWER(COALESCE(c.name, '')) LIKE ?
      ORDER BY 
        CASE 
          WHEN LOWER(p.name) LIKE ? THEN 10
          WHEN LOWER(p.description) LIKE ? THEN 5
          ELSE 1
        END DESC,
        p.created_at DESC
      LIMIT 10
    `;

    const params = [
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
    ];

    const [results] = await db.query(sqlQuery, params);
    console.log(`Found ${results.length} product results`);

    if (results.length === 0) {
      return res.json([]);
    }

    // Process the results with proper image handling
    const products = await Promise.all(
      results.map(async (product) => {
        try {
          // Get the primary image with proper BLOB handling
          let processedImageUrl = null;
          try {
            const [images] = await db.query(
              "SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1",
              [product.product_id]
            );
            if (images.length > 0) {
              const imageUrl = images[0].image_url;

              // Handle BLOB data (binary image data)
              if (imageUrl && Buffer.isBuffer(imageUrl)) {
                processedImageUrl = `data:image/jpeg;base64,${imageUrl.toString(
                  "base64"
                )}`;
              } else if (imageUrl && typeof imageUrl === "string") {
                // Handle file path
                processedImageUrl = `/uploads/${imageUrl}`;
              }
            }
          } catch (imgErr) {
            console.error(
              `Error getting image for product ${product.product_id}:`,
              imgErr.message
            );
          }

          // Ensure price is a number
          const price = Number(product.price) || 0;

          const processedProduct = {
            product_id: product.product_id,
            name: product.name,
            description: product.description || "",
            product_code: product.product_code || "",
            category_name: product.category_name || "Uncategorized",
            category_id: product.category_id,
            price: price,
            average_rating:
              product.average_rating !== null
                ? Number(product.average_rating)
                : 0,
            review_count: Number(product.review_count) || 0,
            image: processedImageUrl,
            stock: Number(product.stock) || 0,
          };

          return processedProduct;
        } catch (err) {
          console.error(
            `Error processing product ${product.product_id}:`,
            err.message
          );
          return null;
        }
      })
    );

    // Filter out any null products from errors
    const validProducts = products.filter((p) => p !== null);
    console.log(`Returning ${validProducts.length} valid products`);

    res.json(validProducts);
  } catch (err) {
    console.error("Error in product search:", err.message);
    res.status(500).json({
      error: "Server error during product search",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

// Handler for GET /api/products/:id (get product by id)
async function getProductById(req, res) {
  try {
    const productId = req.params.id;
    const [productResult] = await db.query(
      `
      SELECT 
        p.product_id, p.name, p.product_code, p.description, p.category_id, 
        p.price, p.discounted_price, p.discount_percentage, p.stock AS stock_quantity, p.created_at, p.updated_at,
        COALESCE(SUM(oi.quantity), 0) as items_sold,
        p.average_rating, p.review_count, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.category_id
      LEFT JOIN order_items oi ON p.product_id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.order_id AND o.order_status IN ('completed', 'delivered')
      WHERE p.product_id = ?
      GROUP BY p.product_id, p.name, p.product_code, p.description, p.category_id, 
               p.price, p.discounted_price, p.discount_percentage, p.stock, p.created_at, p.updated_at, p.average_rating, 
               p.review_count, c.name
    `,
      [productId]
    );
    if (productResult.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }
    const product = {
      ...productResult[0],
      price: Number(productResult[0].price) || 0,
      discounted_price: Number(productResult[0].discounted_price) || 0,
      discount_percentage: Number(productResult[0].discount_percentage) || 0,
      average_rating:
        productResult[0].average_rating !== null
          ? Number(productResult[0].average_rating)
          : 0,
      review_count: Number(productResult[0].review_count) || 0,
    };

    // Get variants including image data
    const [variants] = await db.query(
      "SELECT variant_id, product_id, sku, price, stock, image_url, attributes, created_at, updated_at FROM product_variants WHERE product_id = ?",
      [productId]
    );
    const variantsWithDetails = [];
    for (const variant of variants) {
      let parsedAttributes = {};
      try {
        parsedAttributes =
          typeof variant.attributes === "string"
            ? JSON.parse(variant.attributes)
            : variant.attributes;
      } catch (e) {
        console.error(
          `Error parsing attributes for variant ${variant.variant_id}:`,
          e
        );
      }
      const attributeString = Object.entries(parsedAttributes || {})
        .map(([key, value]) => value)
        .join(" ");
      const variantName = attributeString
        ? `${product.name} - ${attributeString}`
        : product.name;
      let variantImage = null;

      if (variant.image_url) {
        variantImage = {
          id: `variant-img-${variant.variant_id}`,
          url: variant.image_url,
          alt: `${product.name} - ${attributeString}`,
          order: 0,
        };
      }

      variantsWithDetails.push({
        ...variant,
        attributes: parsedAttributes,
        parent_product_id: productId,
        images: variantImage ? [variantImage] : [],
        name: variantName,
      });
    }

    // Get product images as BLOB data
    const [images] = await db.query(
      "SELECT image_id, image_url, alt_text, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order",
      [productId]
    );

    // Process image data
    const processedImages = images.map((img) => {
      // If image_url is a BLOB, convert to base64
      if (img.image_url && Buffer.isBuffer(img.image_url)) {
        return {
          id: img.image_id,
          url: `data:image/jpeg;base64,${img.image_url.toString("base64")}`,
          alt: img.alt_text || product.name,
          order: img.sort_order,
        };
      } else {
        // Otherwise use as URL path
        return {
          id: img.image_id,
          url: `/uploads/${img.image_url}`,
          alt: img.alt_text || product.name,
          order: img.sort_order,
        };
      }
    });

    res.json({
      ...product,
      variants: variantsWithDetails,
      images: processedImages,
    });
  } catch (err) {
    console.error("Error fetching product details:", err);
    res
      .status(500)
      .json({ message: "Server error while fetching product details" });
  }
}

// Handler for PUT /api/products/:id (update product)
async function updateProduct(req, res) {
  // ...migrated as-is from the route file
  // (Insert the full logic from the PUT /:id route handler here)
}

// Handler for DELETE /api/products/:id (delete product)
async function deleteProduct(req, res) {
  // ...migrated as-is from the route file
  // (Insert the full logic from the DELETE /:id route handler here)
}

// Handler for DELETE /api/products/images/:imageId (delete product image)
async function deleteProductImage(req, res) {
  // ...migrated as-is from the route file
  // (Insert the full logic from the DELETE /images/:imageId route handler here)
}

// Handler for GET /api/products/best-sellers (get best sellers based on sales)
async function getBestSellers(req, res) {
  try {
    const limit = 12; // Limit to 12 best sellers

    // SQL to calculate best sellers based on actual sales data
    // Updated to use consistent stock calculation with main products query
    let sql = `
      SELECT
        p.product_id,
        p.name,
        p.product_code,
        p.description,
        p.category_id,
        p.created_at,
        p.updated_at,
        p.is_featured,
        p.price                        AS base_price,
        p.discounted_price,
        p.discount_percentage,
        p.average_rating,
        p.review_count,
        c.name                          AS category_name,
        p.stock as base_stock,
        COALESCE(
          (SELECT SUM(stock) FROM product_variants WHERE product_id = p.product_id),
          p.stock,
          0
        ) AS stock,
        EXISTS (SELECT 1 FROM product_variants WHERE product_id = p.product_id) as has_variants,
        COALESCE(SUM(oi.quantity), 0) as total_sold
      FROM products p
      LEFT JOIN categories c     ON p.category_id = c.category_id
      LEFT JOIN order_items oi  ON p.product_id = oi.product_id
      LEFT JOIN orders o        ON oi.order_id = o.order_id 
                                 AND o.order_status IN ('completed', 'delivered')
      WHERE COALESCE(
        (SELECT SUM(stock) FROM product_variants WHERE product_id = p.product_id),
        p.stock,
        0
      ) > 0
      GROUP BY p.product_id, p.name, p.product_code, p.description, p.category_id,
               p.created_at, p.updated_at, p.is_featured, p.price, p.discounted_price,
               p.discount_percentage, p.average_rating, p.review_count, c.name, p.stock
      HAVING total_sold > 0
      ORDER BY total_sold DESC, p.created_at DESC
      LIMIT ?`;

    const params = [limit];

    const [productsResult] = await db.query(sql, params);
    let products = productsResult;

    // Add debug logging for best sellers
    console.log("Best sellers found:", products.length);

    // Process numeric fields
    for (const product of products) {
      product.price = Number(product.base_price) || 0;
      product.discounted_price = Number(product.discounted_price) || 0;
      product.discount_percentage = Number(product.discount_percentage) || 0;
      product.average_rating =
        product.average_rating !== null ? Number(product.average_rating) : 0;
      product.review_count = Number(product.review_count) || 0;
      product.stock = Number(product.stock) || 0;
      product.total_sold = Number(product.total_sold) || 0;
      delete product.base_price;
      product.variants = [];
    }

    // Process images
    const includeImages =
      req.query.includeImages !== "false" && req.query.includeImages !== "0";
    await processProductImages(products, includeImages);

    return res.json(products);
  } catch (err) {
    console.error("Error in best sellers route:", err);
    return res
      .status(500)
      .json({ message: "Server error while fetching best sellers" });
  }
}

// Serve product image by product ID
const serveProductImage = async (req, res) => {
  try {
    const productId = req.params.id;

    // Get the first image for the product
    const [images] = await db.query(
      "SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1",
      [productId]
    );

    if (images.length === 0 || !images[0].image_url) {
      console.log(`No image found for product ${productId}`);
      return res.status(404).send("Image not found");
    }

    const imageData = images[0].image_url;
    console.log(
      `Found image data for product ${productId}, type:`,
      typeof imageData
    );

    // Set appropriate headers
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 1 day

    // If the image is stored as a Buffer in the database, send it directly
    if (Buffer.isBuffer(imageData)) {
      return res.send(imageData);
    }

    // If it's a string URL/path
    if (typeof imageData === "string") {
      // If it's an external URL, redirect
      if (imageData.startsWith("http")) {
        return res.redirect(imageData);
      }

      // For local files, serve from uploads directory
      // Remove any leading 'uploads/' or '/' from the imageUrl
      const cleanImageUrl = imageData.replace(/^(uploads\/|\/)/, "");
      const filePath = path.join(__dirname, "..", "uploads", cleanImageUrl);

      console.log("Attempting to serve file from:", filePath);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.log("File not found at path:", filePath);
        return res.status(404).send("Image file not found");
      }

      return res.sendFile(filePath);
    }

    // If we get here, the image data is in an unknown format
    console.error("Invalid image data format:", typeof imageData);
    return res.status(500).send("Invalid image format");
  } catch (err) {
    console.error("Error serving product image:", err);
    res.status(500).send("Server error");
  }
};

module.exports = {
  handleCombinedUpload,
  createProduct,
  getProducts,
  searchProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  deleteProductImage,
  serveProductImage,
  getNewArrivals,
  getFlashDeals,
  getBestSellers,
};
