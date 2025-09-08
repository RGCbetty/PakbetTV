const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const subcribeController = require("../controllers/subscribeController");

// Test email endpoint
router.post("/", subcribeController.sendSubcriptionEmail);

module.exports = router;
