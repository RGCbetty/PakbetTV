const db = require("../config/db");

async function getAddresses(req, res) {
  try {
    const userId = req.user.user.id;
    console.log("Fetching addresses for user:", userId);
    const [addresses] = await db.query(
      `SELECT * FROM user_shipping_details WHERE user_id = ? ORDER BY is_default DESC`,
      [userId]
    );
    const addressList = Array.isArray(addresses) ? addresses : [];
    console.log("Returning addresses:", addressList);
    res.json(addressList);
  } catch (err) {
    console.error("Error fetching addresses:", err);
    res.status(500).json({ message: "Server error" });
  }
}

async function addAddress(req, res) {
  try {
    const userId = req.user.user.id;
    console.log("Adding new address for user:", userId);
    console.log("Request body:", req.body);
    const {
      address1,
      address2,
      barangay,
      city_municipality,
      province,
      region,
      postcode,
      address_type,
      is_default,
    } = req.body;
    if (!address1 || !city_municipality || !province || !region || !postcode) {
      return res
        .status(400)
        .json({ message: "Missing required address fields" });
    }
    const [existingAddresses] = await db.query(
      "SELECT id FROM user_shipping_details WHERE user_id = ?",
      [userId]
    );
    const shouldBeDefault = is_default || existingAddresses.length === 0;
    if (shouldBeDefault) {
      await db.query(
        "UPDATE user_shipping_details SET is_default = false WHERE user_id = ?",
        [userId]
      );
    }
    const [result] = await db.query(
      `INSERT INTO user_shipping_details 
      (user_id, address1, address2, barangay, city_municipality, province, region, postcode, address_type, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        address1,
        address2 || "",
        barangay || "",
        city_municipality,
        province,
        region,
        postcode,
        address_type || "home",
        shouldBeDefault,
      ]
    );
    console.log("Address added successfully:", result.insertId);
    res.status(201).json({
      id: result.insertId,
      message: "Address added successfully",
    });
  } catch (err) {
    console.error("Error adding address:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
}

async function setDefaultAddress(req, res) {
  try {
    const userId = req.user.user.id;
    const addressId = req.params.id;
    console.log("Setting default address:", addressId, "for user:", userId);
    const [address] = await db.query(
      "SELECT id FROM user_shipping_details WHERE id = ? AND user_id = ?",
      [addressId, userId]
    );
    if (address.length === 0) {
      return res.status(404).json({ message: "Address not found" });
    }
    await db.query(
      "UPDATE user_shipping_details SET is_default = false WHERE user_id = ?",
      [userId]
    );
    await db.query(
      "UPDATE user_shipping_details SET is_default = true WHERE id = ?",
      [addressId]
    );
    console.log("Default address updated successfully");
    res.json({ message: "Default address updated successfully" });
  } catch (err) {
    console.error("Error updating default address:", err);
    res.status(500).json({ message: "Server error" });
  }
}

async function deleteAddress(req, res) {
  try {
    const userId = req.user.user.id;
    const addressId = req.params.id;
    console.log("Deleting address:", addressId, "for user:", userId);
    const [address] = await db.query(
      "SELECT id, is_default FROM user_shipping_details WHERE id = ? AND user_id = ?",
      [addressId, userId]
    );
    if (address.length === 0) {
      return res.status(404).json({ message: "Address not found" });
    }
    if (address[0].is_default) {
      const [otherAddresses] = await db.query(
        "SELECT id FROM user_shipping_details WHERE user_id = ? AND id != ? LIMIT 1",
        [userId, addressId]
      );
      if (otherAddresses.length > 0) {
        await db.query(
          "UPDATE user_shipping_details SET is_default = true WHERE id = ?",
          [otherAddresses[0].id]
        );
      }
    }
    await db.query("DELETE FROM user_shipping_details WHERE id = ?", [
      addressId,
    ]);
    console.log("Address deleted successfully");
    res.json({ message: "Address deleted successfully" });
  } catch (err) {
    console.error("Error deleting address:", err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  getAddresses,
  addAddress,
  setDefaultAddress,
  deleteAddress,
};
