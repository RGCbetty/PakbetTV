const { body, validationResult } = require("express-validator");
const db = require("../config/db");

// Handler for POST /api/categories
async function createCategory(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { name, description, parent_id } = req.body;
    const [existingCategories] = await db.query(
      "SELECT * FROM categories WHERE name = ?",
      [name]
    );
    if (existingCategories.length > 0) {
      return res.status(400).json({ message: "Category name already exists" });
    }
    if (parent_id) {
      const [parentCategory] = await db.query(
        "SELECT * FROM categories WHERE category_id = ?",
        [parent_id]
      );
      if (parentCategory.length === 0) {
        return res.status(400).json({ message: "Parent category not found" });
      }
    }
    const [result] = await db.query(
      "INSERT INTO categories (name, description, parent_id) VALUES (?, ?, ?)",
      [name, description || null, parent_id || null]
    );
    res.status(201).json({
      message: "Category created successfully",
      category: {
        category_id: result.insertId,
        name,
        description,
        parent_id: parent_id || null,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server error" });
  }
}

// Handler for GET /api/categories
async function getCategories(req, res) {
  console.log("Incoming Request: GET /api/categories");
  console.log("Headers:", req.headers);
  console.log("Query params:", req.query);
  try {
    const parent_id = req.query.parent_id;
    let query =
      "SELECT category_id, name, description, parent_id, category_image FROM categories";
    const params = [];
    if (parent_id !== undefined) {
      if (parent_id === "null") {
        query += " WHERE parent_id IS NULL";
      } else {
        query += " WHERE parent_id = ?";
        params.push(parent_id);
      }
    }
    query += " ORDER BY name ASC";
    console.log("Executing categories query:", query);
    console.log("Query params:", params);
    const [categories] = await db.query(query, params);
    console.log("Raw categories from database:", categories);
    console.log("Number of categories found:", categories.length);
    const processedCategories = categories.map((category) => {
      if (category.category_image) {
        category.category_image = `data:image/png;base64,${category.category_image.toString(
          "base64"
        )}`;
      }
      return category;
    });
    console.log("Processed categories:", processedCategories);
    console.log(
      "Sending categories response with",
      processedCategories.length,
      "categories"
    );
    res.json(processedCategories);
  } catch (err) {
    console.error("Categories API Error:", err.message);
    console.error("Full error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// Handler for GET /api/categories/tree
async function getCategoryTree(req, res) {
  try {
    const [categories] = await db.query(
      "SELECT * FROM categories ORDER BY name ASC"
    );
    const categoriesMap = {};
    categories.forEach((category) => {
      categoriesMap[category.category_id] = { ...category, children: [] };
    });
    const rootCategories = [];
    categories.forEach((category) => {
      if (category.parent_id) {
        categoriesMap[category.parent_id].children.push(
          categoriesMap[category.category_id]
        );
      } else {
        rootCategories.push(categoriesMap[category.category_id]);
      }
    });
    res.json(rootCategories);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server error" });
  }
}

// Handler for GET /api/categories/:id
async function getCategoryById(req, res) {
  try {
    const categoryId = req.params.id;
    const [categories] = await db.query(
      "SELECT * FROM categories WHERE category_id = ?",
      [categoryId]
    );
    if (categories.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }
    res.json(categories[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server error" });
  }
}

// Handler for PUT /api/categories/:id
async function updateCategory(req, res) {
  try {
    const categoryId = req.params.id;
    const { name, description, parent_id } = req.body;
    const [categories] = await db.query(
      "SELECT * FROM categories WHERE category_id = ?",
      [categoryId]
    );
    if (categories.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }
    if (name) {
      const [existingCategories] = await db.query(
        "SELECT * FROM categories WHERE name = ? AND category_id != ?",
        [name, categoryId]
      );
      if (existingCategories.length > 0) {
        return res
          .status(400)
          .json({ message: "Category name already exists" });
      }
    }
    if (parent_id !== undefined && parent_id !== null) {
      if (parseInt(parent_id) === parseInt(categoryId)) {
        return res
          .status(400)
          .json({ message: "Category cannot be its own parent" });
      }
      const [parentCategory] = await db.query(
        "SELECT * FROM categories WHERE category_id = ?",
        [parent_id]
      );
      if (parentCategory.length === 0) {
        return res.status(400).json({ message: "Parent category not found" });
      }
    }
    const updates = {};
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (parent_id !== undefined)
      updates.parent_id = parent_id === null ? null : parent_id;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No update data provided" });
    }
    let sql = "UPDATE categories SET ";
    const values = [];
    Object.keys(updates).forEach((key, index) => {
      if (updates[key] === null) {
        sql += `${key} = NULL`;
      } else {
        sql += `${key} = ?`;
        values.push(updates[key]);
      }
      if (index < Object.keys(updates).length - 1) {
        sql += ", ";
      }
    });
    sql += " WHERE category_id = ?";
    values.push(categoryId);
    const [result] = await db.query(sql, values);
    res.json({ message: "Category updated successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server error" });
  }
}

// Handler for DELETE /api/categories/:id
async function deleteCategory(req, res) {
  try {
    const categoryId = req.params.id;
    const [childCategories] = await db.query(
      "SELECT * FROM categories WHERE parent_id = ?",
      [categoryId]
    );
    if (childCategories.length > 0) {
      return res.status(400).json({
        message:
          "Cannot delete category with child categories. Please delete or reassign child categories first.",
      });
    }
    const [products] = await db.query(
      "SELECT * FROM products WHERE category_id = ?",
      [categoryId]
    );
    if (products.length > 0) {
      return res.status(400).json({
        message:
          "Cannot delete category with associated products. Please reassign products first.",
      });
    }
    const [result] = await db.query(
      "DELETE FROM categories WHERE category_id = ?",
      [categoryId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Category not found" });
    }
    res.json({ message: "Category deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  createCategory,
  getCategories,
  getCategoryTree,
  getCategoryById,
  updateCategory,
  deleteCategory,
};
