const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config({ path: "../.env" }); // Adjust path based on your file location

const path = require("path");
const session = require("express-session");
const passport = require("./config/passport");
dotenv.config();
const { runMigrations } = require("./config/db-migrations");
const app = express();
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const crypto = require("crypto");

// Generate secure session secret if not provided
const generateSecureSecret = () => crypto.randomBytes(64).toString("hex");

//Express Rate Limit to avoid abuse - More restrictive
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Reduced from 1000 to 300 requests per 15 minutes
  message: "Too many requests, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Add additional security headers
  skip: (req) => {
    // Skip rate limiting for health checks and static assets
    return req.path === "/health" || req.path.startsWith("/uploads/");
  },
});

app.use(limiter);

// Enhanced security headers with helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        connectSrc: [
          "'self'",
          "https://api.ninjavan.co",
          "https://api-sandbox.ninjavan.co",
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Needed for certain integrations
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  })
);

// Configure CORS origins based on environment
const getAllowedOrigins = () => {
  const clientUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL;
  const isDevelopment = process.env.NODE_ENV === "development";

  if (isDevelopment) {
    // In development, allow multiple localhost ports
    return [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
    ];
  } else {
    // In production, use the specific client URL
    return clientUrl ? [clientUrl] : ["https://michaeldemesa.com"];
  }
};

app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: ["X-Total-Count"],
  })
);

// Body parsing with size limits
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Error handling middleware (moved up before routes)
app.use((err, req, res, next) => {
  console.error("Server error:", {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
  res.status(500).json({
    message: "Something went wrong!",
    error:
      process.env.NODE_ENV === "production" ? {} : { message: err.message },
  });
});

// Session and Passport setup with enhanced security
app.use(
  session({
    secret: process.env.SESSION_SECRET || generateSecureSecret(),
    resave: false,
    saveUninitialized: false,
    name: "pakbet.sid", // Custom session name
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true, // Prevent XSS
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Request logging (only in development)
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`Request: ${req.method} ${req.path}`);
  }
  next();
});

// Static file serving with security headers
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    maxAge: "1d",
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "public, max-age=86400");
    },
  })
);

const userRoutes = require("./routes/users");
const productRoutes = require("./routes/products");
const categoryRoutes = require("./routes/categories");
const cartRoutes = require("./routes/cart");
const orderRoutes = require("./routes/orders");
const authRoutes = require("./routes/auth");
const transactionRoutes = require("./routes/transactions");
const reviewRoutes = require("./routes/reviews");
const paymentRoutes = require("./routes/payments");
const deliveryRoutes = require("./routes/delivery");
const adminRoutes = require("./routes/admin");
const cmsRoutes = require("./routes/cms");
const emailRoutes = require("./routes/email");
const locationRoutes = require("./routes/locations");
const voucherRoutes = require("./routes/vouchers");
const promotionRoutes = require("./routes/promotions");
const userWebhookRoutes = require("./routes/userWebhooks");

// Import cron jobs
const { scheduleOrderConfirmation } = require("./cron/orderConfirmation");
const { startPaymentStatusChecker } = require("./cron/paymentStatusChecker");
const { startAutoCompletionJob } = require("./cron/autoCompletionCron");
const orderTimeoutCron = require("./cron/orderTimeoutCron");

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/delivery", deliveryRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/cms", cmsRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/vouchers", voucherRoutes); // Keep for backward compatibility
app.use("/api/promotions", promotionRoutes); // New promotions API
app.use("/api/user", userWebhookRoutes); // User webhook monitoring

app.get("/transaction-complete", (req, res) => {
  console.log(`Received Dragonpay return:`, req.query.txnid, req.query.status);
  const { txnid, refno, status, message } = req.query;
  const htmlResponse = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transaction Complete</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        line-height: 1.6;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
      }
      .transaction-box {
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 20px;
        margin-top: 20px;
        background-color: #f9f9f9;
      }
      .success {
        color: #2e7d32;
        font-weight: bold;
      }
      .failure {
        color: #c62828;
        font-weight: bold;
      }
      .pending {
        color: #f57c00;
        font-weight: bold;
      }
      .status-circle {
        display: inline-block;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 8px;
        vertical-align: middle;
      }
      .home-button {
        display: inline-block;
        background-color: #6e4b36;
        color: white;
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        text-decoration: none;
        margin-top: 20px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <h1>Transaction Complete</h1>
    <div class="transaction-box">
      <h2>Payment Status: 
        <span class="${
          status === "S" ? "success" : status === "P" ? "pending" : "failure"
        }">
          <span class="status-circle" style="background-color: ${
            status === "S" ? "#2e7d32" : status === "P" ? "#f57c00" : "#c62828"
          };"></span>
          ${status === "S" ? "Success" : status === "P" ? "Pending" : "Failed"}
        </span>
      </h2>
      <p><strong>Transaction ID:</strong> ${txnid || "Not available"}</p>
      <p><strong>Reference No:</strong> ${refno || "Not available"}</p>
      <p><strong>Message:</strong> ${message || "No message"}</p>
      ${
        status === "S"
          ? `<p>Thank you for your purchase! Your order is now being processed.</p>
         <p>You will receive an email confirmation shortly.</p>`
          : status === "P"
          ? `<p>Your payment is pending. We'll update your order status once the payment is confirmed.</p>`
          : `<p>There was an issue with your payment. Please try again or contact customer support.</p>`
      }
    </div>
    <a href="/" class="home-button">Return to Home</a>
  </body>
  </html>
  `;
  res.set("Content-Type", "text/html");
  res.send(htmlResponse);
});

app.get("/", (req, res) => {
  res.json({ message: "Welcome to FengShui E-Commerce API" });
});

// 404 handler for unknown routes
app.use("*", (req, res) => {
  res.status(404).json({ message: "Resource not found" });
});

// Global error handler (moved to end)
app.use((err, req, res, next) => {
  console.error("Unhandled error:", {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
  res.status(500).json({
    message: "Something went wrong!",
    error:
      process.env.NODE_ENV === "production" ? {} : { message: err.message },
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Env: ${process.env.NODE_ENV || "development"}`);

  console.log("Starting cron jobs...");
  try {
    scheduleOrderConfirmation();
    console.log("Order confirmation cron scheduled");
    startPaymentStatusChecker();
    console.log("Payment checker cron started");
    startAutoCompletionJob();
    console.log("Auto-completion cron started");
    orderTimeoutCron.start();
    console.log(
      "Order timeout cron started - will cancel unpaid orders after 3 hours"
    );
  } catch (cronError) {
    console.error("Cron start error:", cronError);
  }
});
