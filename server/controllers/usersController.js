// All logic from users.js route handlers should be moved here as named exports.
// Export each handler as a named function, do not change any logic.
// (Insert all route handler logic and helper functions from users.js here)

const { validationResult } = require("express-validator");
const db = require("../config/db");
const bcrypt = require("bcryptjs");

// User registration
exports.registerUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { firstName, lastName, username, email, password } = req.body;

    // Check if user already exists (optimized / limit 1)
    const [existingRows] = await db.query(
      "SELECT 1 FROM users WHERE email = ? OR username = ? LIMIT 1",
      [email, username]
    );

    if (existingRows.length > 0) {
      return res.status(400).json({
        errors: [{ msg: "User already exists" }],
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert user into database
    const [insertResult] = await db.query(
      "INSERT INTO users (first_name, last_name, username, email, password) VALUES (?, ?, ?, ?, ?)",
      [firstName, lastName, username, email, hashedPassword]
    );

    res.status(201).json({
      message: "User registered successfully",
      userId: insertResult.insertId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get all users (admin only)
exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.query(
      "SELECT user_id, first_name, last_name, username, email, created_at FROM users"
    );
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get user shipping addresses
exports.getShippingAddresses = async (req, res) => {
  try {
    const [addresses] = await db.query(
      `SELECT * FROM user_shipping_details 
       WHERE user_id = ?
       ORDER BY is_default DESC, updated_at DESC, id DESC`,
      [req.user.id]
    );

    console.log(
      `📦 Fetched ${addresses.length} shipping addresses for user ${req.user.id}`
    );
    // Note: Detailed address logging removed to reduce log noise

    res.json(addresses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { firstName, lastName, email, username, phone } = req.body;

    await db.query(
      "UPDATE users SET first_name = ?, last_name = ?, email = ?, username = ?, phone = ? WHERE user_id = ?",
      [firstName, lastName, email, username, phone || null, req.user.id]
    );

    res.json({ message: "Profile updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT user_id, first_name, last_name, username, email, created_at FROM users WHERE user_id = ?",
      [req.params.id]
    );

    const user = rows[0];

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Update user by ID
exports.updateUserById = async (req, res) => {
  try {
    const { firstName, lastName, email, username, phone } = req.body;

    await db.query(
      "UPDATE users SET first_name = ?, last_name = ?, email = ?, username = ?, phone = ? WHERE user_id = ?",
      [firstName, lastName, email, username, phone || null, req.params.id]
    );

    res.json({ message: "User updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Delete user by ID
exports.deleteUserById = async (req, res) => {
  try {
    await db.query("DELETE FROM users WHERE user_id = ?", [req.params.id]);
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Get user profile
exports.getUserProfile = async (req, res) => {
  try {
    const [rowsProfile] = await db.query(
      "SELECT user_id, first_name, last_name, username, email, phone, created_at FROM users WHERE user_id = ?",
      [req.user.id]
    );
    res.json(rowsProfile[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Debug profile info
exports.profileDebug = async (req, res) => {
  try {
    res.json({
      user: req.user,
      session: req.session,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Add or update shipping address
exports.addOrUpdateShippingAddress = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(
        "Validation errors on addOrUpdateShippingAddress:",
        errors.array()
      );
      return res.status(400).json({ errors: errors.array() });
    }

    // Destructure the supported address fields from the request body. Any missing optional
    // fields will simply default to `null` so the INSERT works even if they are omitted.
    const {
      address1,
      address2,
      area,
      city,
      state,
      postcode,
      country = "PH",
      address_type = "home",
      is_default = false,
      // Philippine-specific / extended location details
      region,
      province,
      city_municipality,
      barangay,
      street_name,
      building,
      house_number,
    } = req.body;

    // If this new address should be the default one, clear existing defaults first
    if (is_default) {
      await db.query(
        "UPDATE user_shipping_details SET is_default = 0 WHERE user_id = ?",
        [req.user.id]
      );
    }

    // Insert the address. We explicitly list every column that exists in the table so we
    // avoid referencing non-existent columns (e.g. the previous `street_address`).
    const [insertAddress] = await db.query(
      `INSERT INTO user_shipping_details (
        user_id,
        address1,
        address2,
        area,
        city,
        state,
        postcode,
        country,
        address_type,
        is_default,
        region,
        province,
        city_municipality,
        barangay,
        street_name,
        building,
        house_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        address1,
        address2 || null,
        area || null,
        city || null,
        state || null,
        postcode,
        country,
        address_type,
        is_default,
        region || null,
        province || null,
        city_municipality || null,
        barangay || null,
        street_name || null,
        building || null,
        house_number || null,
      ]
    );

    // Debug: confirm insertId
    console.log(
      "Inserted new shipping address with id",
      insertAddress.insertId,
      "for user",
      req.user.id
    );

    res.status(201).json({
      message: "Shipping address added successfully",
      addressId: insertAddress.insertId,
    });
  } catch (err) {
    console.error("Error in addOrUpdateShippingAddress:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Delete shipping address
exports.deleteShippingAddress = async (req, res) => {
  try {
    await db.query(
      "DELETE FROM user_shipping_details WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id]
    );
    res.json({ message: "Shipping address deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Update shipping details
exports.updateShipping = async (req, res) => {
  try {
    const { addressId } = req.body;
    await db.query(
      "UPDATE users SET default_shipping_id = ? WHERE user_id = ?",
      [addressId, req.user.id]
    );
    res.json({ message: "Shipping details updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Update username
exports.updateUsername = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username } = req.body;
    await db.query("UPDATE users SET username = ? WHERE user_id = ?", [
      username,
      req.user.id,
    ]);
    res.json({ message: "Username updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Delete account
exports.deleteAccount = async (req, res) => {
  try {
    await db.query("DELETE FROM users WHERE user_id = ?", [req.user.id]);
    req.session.destroy();
    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// Check if user can delete account
exports.canDeleteAccount = async (req, res) => {
  try {
    // First check if user exists
    const [user] = await db.query(
      "SELECT user_id FROM users WHERE user_id = ?",
      [req.user.id]
    );

    if (!user.length) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check for active orders
    const [activeOrders] = await db.query(
      'SELECT 1 FROM orders WHERE user_id = ? AND order_status NOT IN ("completed", "cancelled") LIMIT 1',
      [req.user.id]
    );

    const canDelete = activeOrders.length === 0;

    res.json({
      canDelete,
      message: canDelete
        ? "Account can be deleted"
        : "Cannot delete account while there are active orders",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
