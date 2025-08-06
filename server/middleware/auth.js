const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const db = require("../config/db");
dotenv.config();

const auth = (req, res, next) => {
  const authHeader = req.header("Authorization");

  // Reduced logging for security - only log basic info
  if (process.env.NODE_ENV === "development") {
    console.log(`Auth: ${req.method} ${req.path}`);
  }

  // Skip auth for certain endpoints if needed
  // const publicEndpoints = ['/api/products', '/api/categories'];
  // if (publicEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
  //   return next();
  // }

  if (!authHeader) {
    if (process.env.NODE_ENV === "development") {
      console.log("Auth Error: No Authorization header");
    }
    return res
      .status(401)
      .json({ message: "No authorization header, authentication required" });
  }

  if (!authHeader.startsWith("Bearer ")) {
    if (process.env.NODE_ENV === "development") {
      console.log("Auth Error: Invalid Authorization header");
    }
    return res
      .status(401)
      .json({ message: "Invalid authorization format, Bearer token required" });
  }

  try {
    const token = authHeader.split(" ")[1];

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not set in environment variables");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Don't log token details for security
    if (process.env.NODE_ENV === "development") {
      console.log("Processing authentication token");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Don't log user IDs for security
    if (process.env.NODE_ENV === "development") {
      console.log("Token verification successful");
    }

    // Check for either id or user_id in token
    const userId = decoded.id || decoded.user_id;
    if (!userId) {
      if (process.env.NODE_ENV === "development") {
        console.log("Auth Error: No user ID in token");
      }
      return res
        .status(401)
        .json({ message: "Invalid token - missing user ID" });
    }

    // Set user object with consistent structure
    req.user = {
      id: userId,
      email: decoded.email,
      userType: decoded.userType || "customer",
    };

    // Don't log sensitive user information
    if (process.env.NODE_ENV === "development") {
      console.log(
        `Authentication successful for user type: ${req.user.userType}`
      );
    }

    next();
  } catch (err) {
    // Log security-relevant errors but not sensitive details
    console.error("Token verification error:", {
      name: err.name,
      timestamp: new Date().toISOString(),
    });

    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token has expired" });
    }

    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({
        message: "Invalid token",
      });
    }

    res.status(401).json({
      message: "Token verification failed",
    });
  }
};

const admin = (req, res, next) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`Admin check for user type: ${req.user?.userType}`);
  }

  if (!req.user) {
    if (process.env.NODE_ENV === "development") {
      console.log("Admin Error: No user object");
    }
    return res.status(401).json({ message: "Authentication required" });
  }

  // Case-insensitive check for admin rights
  if (req.user.userType?.toLowerCase() === "admin") {
    if (process.env.NODE_ENV === "development") {
      console.log("Admin access granted");
    }
    next();
  } else {
    if (process.env.NODE_ENV === "development") {
      console.log("Admin Error: Not admin");
    }
    res
      .status(403)
      .json({ message: "Access denied. Admin privileges required." });
  }
};

// Middleware to check if user's email is verified
const requireVerification = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Check user's verification status from database
    const [rows] = await db.query(
      "SELECT is_verified, email FROM users WHERE user_id = ? LIMIT 1",
      [req.user.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        message: "Please Verify Your Account",
        needsVerification: true,
        email: user.email,
      });
    }

    next();
  } catch (err) {
    console.error("Verification check error:", err);
    res.status(500).json({ message: "Server error during verification check" });
  }
};

module.exports = { auth, admin, requireVerification };
