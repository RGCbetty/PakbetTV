const db = require("../config/db");
const { validationResult } = require("express-validator");

async function updateProductRating(productId) {
  try {
    const [ratingResult] = await db.query(
      "SELECT AVG(rating) as average_rating, COUNT(*) as review_count FROM reviews WHERE product_id = ?",
      [productId]
    );
    const average_rating = ratingResult[0].average_rating || null;
    const review_count = ratingResult[0].review_count || 0;
    await db.query(
      "UPDATE products SET average_rating = ?, review_count = ? WHERE product_id = ?",
      [average_rating, review_count, productId]
    );
    console.log(
      `Updated ratings for product ${productId}: Avg ${average_rating}, Count ${review_count}`
    );
  } catch (error) {
    console.error(`Failed to update rating for product ${productId}:`, error);
  }
}

async function createReview(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const productId = req.params.productId;
  const userId = req.user?.id || req.user?.user?.id;
  const { rating, review_text } = req.body;
  if (!userId) {
    console.error("Auth Error: User ID not found in token payload", req.user);
    return res
      .status(401)
      .json({ message: "Could not identify user from token" });
  }
  try {
    const [purchases] = await db.query(
      `SELECT o.order_id 
       FROM orders o 
       JOIN order_items oi ON o.order_id = oi.order_id 
       WHERE o.user_id = ? AND oi.product_id = ? AND o.order_status = 'delivered'`,
      [userId, productId]
    );
    if (purchases.length === 0) {
      return res.status(403).json({
        error: "purchase_required",
        message: "Please purchase and receive the product before reviewing",
      });
    }
    const [products] = await db.query(
      "SELECT product_id FROM products WHERE product_id = ?",
      [productId]
    );
    if (products.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }
    const [existingReviews] = await db.query(
      "SELECT review_id FROM reviews WHERE product_id = ? AND user_id = ?",
      [productId, userId]
    );
    if (existingReviews.length > 0) {
      return res.status(400).json({
        error: "already_reviewed",
        message: "You have already reviewed this product",
      });
    }
    const [result] = await db.query(
      "INSERT INTO reviews (product_id, user_id, rating, review_text) VALUES (?, ?, ?, ?)",
      [productId, userId, rating, review_text || null]
    );
    await updateProductRating(productId);
    res.status(201).json({
      message: "Review created successfully",
      review_id: result.insertId,
    });
  } catch (err) {
    console.error("Error creating review:", err);
    res.status(500).json({ message: "Server error" });
  }
}

async function getProductReviews(req, res) {
  const productId = req.params.productId;
  try {
    const [reviews] = await db.query(
      `SELECT r.*, u.username, u.first_name, u.last_name 
       FROM reviews r 
       JOIN users u ON r.user_id = u.user_id 
       WHERE r.product_id = ? 
       ORDER BY r.created_at DESC`,
      [productId]
    );
    const formattedReviews = reviews.map((review) => ({
      ...review,
      username:
        review.first_name && review.last_name
          ? `${review.first_name} ${review.last_name}`
          : review.username,
    }));
    res.json(formattedReviews);
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ message: "Server error" });
  }
}

async function updateReview(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const reviewId = req.params.reviewId;
  const userId = req.user?.id || req.user?.user?.id;
  const { rating, review_text } = req.body;
  try {
    const [reviews] = await db.query(
      "SELECT * FROM reviews WHERE review_id = ?",
      [reviewId]
    );
    if (reviews.length === 0) {
      return res.status(404).json({ message: "Review not found" });
    }
    const review = reviews[0];
    if (review.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "User not authorized to update this review" });
    }
    const updateFields = {};
    if (rating !== undefined) updateFields.rating = rating;
    if (review_text !== undefined) updateFields.review_text = review_text;
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }
    updateFields.updated_at = new Date();
    await db.query("UPDATE reviews SET ? WHERE review_id = ?", [
      updateFields,
      reviewId,
    ]);
    if (rating !== undefined) {
      await updateProductRating(review.product_id);
    }
    res.json({ message: "Review updated successfully" });
  } catch (err) {
    console.error("Error updating review:", err);
    res.status(500).json({ message: "Server error" });
  }
}

async function deleteReview(req, res) {
  const reviewId = req.params.reviewId;
  const userId = req.user?.id || req.user?.user?.id;
  try {
    const [reviews] = await db.query(
      "SELECT * FROM reviews WHERE review_id = ?",
      [reviewId]
    );
    if (reviews.length === 0) {
      return res.status(404).json({ message: "Review not found" });
    }
    const review = reviews[0];
    if (review.user_id !== userId) {
      return res
        .status(403)
        .json({ message: "User not authorized to delete this review" });
    }
    await db.query("DELETE FROM reviews WHERE review_id = ?", [reviewId]);
    await updateProductRating(review.product_id);
    res.json({ message: "Review deleted successfully" });
  } catch (err) {
    console.error("Error deleting review:", err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  createReview,
  getProductReviews,
  updateReview,
  deleteReview,
};
