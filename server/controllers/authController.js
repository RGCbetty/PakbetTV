const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const db = require("../config/db");
const passport = require("passport");
const fetch = require("node-fetch");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { sendEmailVerification } = require("../services/emailService");

// Account lockout tracking (in production, consider using Redis)
const loginAttempts = new Map();
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5; // Maximum attempts before lockout

// Email verification rate limiting (in production, consider using Redis)
const emailResendAttempts = new Map();
const EMAIL_RESEND_LIMIT = 3; // Maximum resend attempts per email
const EMAIL_RESEND_WINDOW = 60 * 60 * 1000; // 1 hour window

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // Reduced from 100 to 20 login attempts per 15 minutes
  message: "Too many authentication attempts. Please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Helper function to check account lockout
const checkAccountLockout = (identifier) => {
  const attempts = loginAttempts.get(identifier);
  if (!attempts) return { locked: false, remainingTime: 0 };

  const now = Date.now();
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    const timeRemaining = LOCKOUT_TIME - (now - attempts.firstAttempt);
    if (timeRemaining > 0) {
      return {
        locked: true,
        remainingTime: Math.ceil(timeRemaining / 1000 / 60),
      };
    } else {
      // Reset attempts after lockout period
      loginAttempts.delete(identifier);
      return { locked: false, remainingTime: 0 };
    }
  }
  return { locked: false, remainingTime: 0 };
};

// Helper function to record failed login attempt
const recordFailedAttempt = (identifier) => {
  const now = Date.now();
  const attempts = loginAttempts.get(identifier) || {
    count: 0,
    firstAttempt: now,
  };

  // Reset if more than lockout time has passed
  if (now - attempts.firstAttempt > LOCKOUT_TIME) {
    attempts.count = 1;
    attempts.firstAttempt = now;
  } else {
    attempts.count++;
  }

  loginAttempts.set(identifier, attempts);
};

// Helper function to clear login attempts on successful login
const clearLoginAttempts = (identifier) => {
  loginAttempts.delete(identifier);
};

// Helper functions for email resend rate limiting
const checkEmailResendLimit = (email) => {
  const attempts = emailResendAttempts.get(email);

  if (!attempts) {
    return { allowed: true, remainingAttempts: EMAIL_RESEND_LIMIT };
  }

  const now = Date.now();

  // If the window has expired, reset attempts
  if (now - attempts.firstAttempt > EMAIL_RESEND_WINDOW) {
    emailResendAttempts.delete(email);
    return { allowed: true, remainingAttempts: EMAIL_RESEND_LIMIT };
  }

  // Check if limit exceeded
  if (attempts.count >= EMAIL_RESEND_LIMIT) {
    const timeRemaining = Math.ceil(
      (EMAIL_RESEND_WINDOW - (now - attempts.firstAttempt)) / (60 * 1000)
    ); // minutes
    return {
      allowed: false,
      remainingAttempts: 0,
      timeRemaining: timeRemaining,
    };
  }

  return {
    allowed: true,
    remainingAttempts: EMAIL_RESEND_LIMIT - attempts.count,
  };
};

const recordEmailResendAttempt = (email) => {
  const now = Date.now();
  const attempts = emailResendAttempts.get(email);

  if (!attempts) {
    emailResendAttempts.set(email, {
      count: 1,
      firstAttempt: now,
    });
  } else {
    attempts.count++;
  }
};

// Helper function to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.user_id,
      email: user.email,
      userType: user.user_type || "customer",
    },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );
};

// Export all route handlers as named functions
// Each function receives (req, res, next) as arguments

// ... All route handler functions from auth.js go here ...
// For brevity, you will need to move each handler function (signup, login, me, refresh, google, facebook, forgot-password, etc.)
// and export them at the end as named exports.

// Example:
// async function signup(req, res) { ... }
// async function login(req, res) { ... }
// ...
// module.exports = { signup, login, ... };

// Signup handler
exports.signup = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, firstname, lastname, email, password } = req.body;

    // Check if user exists (optimized / limit 1)
    const [existingUserRows] = await db.query(
      "SELECT 1 FROM users WHERE email = ? OR username = ? LIMIT 1",
      [email, username]
    );

    if (existingUserRows.length > 0) {
      return res.status(400).json({
        errors: [{ msg: "User already exists" }],
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12); // Increased from 10 to 12 for better security
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    // Create user (is_verified defaults to FALSE)
    const [insertResult] = await db.query(
      "INSERT INTO users (username, first_name, last_name, email, password, verification_token, verification_token_expires) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        username,
        firstname,
        lastname,
        email,
        hashedPassword,
        verificationToken,
        verificationTokenExpires,
      ]
    );

    // Send verification email
    try {
      await sendEmailVerification(email, verificationToken, firstname);
      console.log(`Verification email sent to ${email}`);
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      // Note: We don't fail the registration if email fails, but we log it
    }

    // Don't generate a token immediately - user needs to verify email first
    res.status(201).json({
      message:
        "Registration successful! Please check your email to verify your account.",
      user: {
        id: insertResult.insertId,
        username,
        email,
        verified: false,
      },
    });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Login handler with account lockout protection
exports.login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { emailOrUsername, password } = req.body;

    // Check account lockout
    const lockoutStatus = checkAccountLockout(emailOrUsername);
    if (lockoutStatus.locked) {
      return res.status(429).json({
        message: `Account temporarily locked. Try again in ${lockoutStatus.remainingTime} minutes.`,
      });
    }

    // Find user with user_type and verification status (select only needed columns)
    const [rows] = await db.query(
      "SELECT user_id, username, email, password, user_type, is_verified FROM users WHERE email = ? OR username = ? LIMIT 1",
      [emailOrUsername, emailOrUsername]
    );

    const user = rows[0];
    if (!user) {
      recordFailedAttempt(emailOrUsername);
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      recordFailedAttempt(emailOrUsername);
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // Check if email is verified
    if (!user.is_verified) {
      return res.status(403).json({
        message: "Please Verify Your Account",
        needsVerification: true,
        email: user.email,
      });
    }

    // Clear failed attempts on successful login
    clearLoginAttempts(emailOrUsername);

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
        userType: user.user_type || "customer",
      },
    });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Get current user
exports.me = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT user_id, username, email, first_name, last_name, phone, user_type FROM users WHERE user_id = ? LIMIT 1",
      [req.user.id]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      id: user.user_id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      userType: user.user_type || "customer",
    });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Refresh token
exports.refresh = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: "Token is required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await db.query(
      "SELECT user_id, email, user_type FROM users WHERE user_id = ?",
      [decoded.id]
    );

    const user = rows[0];
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const newToken = generateToken(user);
    res.json({ token: newToken });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(401).json({ message: "Invalid token" });
  }
};

// Google callback
exports.googleCallback = (req, res) => {
  const token = generateToken(req.user);
  res.redirect(`/social-auth-success?token=${token}`);
};

// Facebook authentication
exports.facebookAuth = passport.authenticate("facebook", { scope: ["email"] });

// Facebook callback
exports.facebookCallback = (req, res) => {
  const token = generateToken(req.user);
  res.redirect(`/social-auth-success?token=${token}`);
};

// Forgot password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const [rows] = await db.query(
      "SELECT user_id FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex"); // Increased from 20 to 32 bytes
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour

    await db.query(
      "UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE user_id = ?",
      [resetToken, resetTokenExpiry, user.user_id]
    );

    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    await transporter.sendMail({
      to: email,
      subject: "Password Reset Request",
      html: `Please click this link to reset your password: <a href="${resetUrl}">${resetUrl}</a>`,
    });

    res.json({ message: "Password reset email sent" });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Verify reset token
exports.verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;
    const [rows] = await db.query(
      "SELECT user_id FROM users WHERE reset_token = ? AND reset_token_expiry > ? LIMIT 1",
      [token, Date.now()]
    );

    const user = rows[0];
    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset token" });
    }

    res.json({ message: "Token is valid" });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const [rows] = await db.query(
      "SELECT user_id FROM users WHERE reset_token = ? AND reset_token_expiry > ? LIMIT 1",
      [token, Date.now()]
    );

    const user = rows[0];
    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset token" });
    }

    const salt = await bcrypt.genSalt(12); // Increased from 10 to 12
    const hashedPassword = await bcrypt.hash(password, salt);

    await db.query(
      "UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE user_id = ?",
      [hashedPassword, user.user_id]
    );

    res.json({ message: "Password has been reset" });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Update password
exports.updatePassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const [rows] = await db.query(
      "SELECT password FROM users WHERE user_id = ? LIMIT 1",
      [req.user.id]
    );
    const user = rows[0];

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const salt = await bcrypt.genSalt(12); // Increased from 10 to 12
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await db.query("UPDATE users SET password = ? WHERE user_id = ?", [
      hashedPassword,
      req.user.id,
    ]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Verify email address
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res
        .status(400)
        .json({ message: "Verification token is required" });
    }

    // Find user with this verification token that hasn't expired
    const [rows] = await db.query(
      "SELECT user_id, email, first_name, is_verified FROM users WHERE verification_token = ? AND verification_token_expires > ? LIMIT 1",
      [token, Date.now()]
    );

    const user = rows[0];
    if (!user) {
      return res.status(400).json({
        message:
          "Invalid or expired verification token. Please request a new verification email.",
        expired: true,
      });
    }

    if (user.is_verified) {
      return res.status(200).json({
        message: "Email already verified. You can now log in.",
        alreadyVerified: true,
      });
    }

    // Update user to verified and clear verification token
    await db.query(
      "UPDATE users SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL WHERE user_id = ?",
      [user.user_id]
    );

    console.log(`Email verified for user: ${user.email}`);

    res.status(200).json({
      message:
        "Email verified successfully! You can now log in to your account.",
      verified: true,
    });
  } catch (err) {
    console.error("Email verification error:", err.message);
    res.status(500).json({ message: "Server error during email verification" });
  }
};

// Resend verification email
exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Check rate limiting
    const rateLimitStatus = checkEmailResendLimit(email);
    if (!rateLimitStatus.allowed) {
      return res.status(429).json({
        message: `Too many verification email requests. Please wait ${rateLimitStatus.timeRemaining} minutes before trying again.`,
      });
    }

    // Find user by email
    const [rows] = await db.query(
      "SELECT user_id, email, first_name, is_verified FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    const user = rows[0];
    if (!user) {
      // Still record attempt even for non-existent users to prevent enumeration
      recordEmailResendAttempt(email);
      return res.status(404).json({ message: "User not found" });
    }

    if (user.is_verified) {
      recordEmailResendAttempt(email);
      return res.status(400).json({
        message: "Email is already verified. You can log in to your account.",
      });
    }

    // Record the resend attempt
    recordEmailResendAttempt(email);

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    // Update user with new verification token
    await db.query(
      "UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE user_id = ?",
      [verificationToken, verificationTokenExpires, user.user_id]
    );

    // Send verification email
    try {
      await sendEmailVerification(email, verificationToken, user.first_name);
      console.log(`Verification email resent to ${email}`);
    } catch (emailError) {
      console.error("Failed to resend verification email:", emailError);
      return res.status(500).json({
        message: "Failed to send verification email. Please try again later.",
      });
    }

    const remainingAttempts = rateLimitStatus.remainingAttempts - 1;
    const responseMessage =
      remainingAttempts > 0
        ? `Verification email sent! Please check your inbox. You have ${remainingAttempts} resend attempts remaining.`
        : "Verification email sent! Please check your inbox. No more resend attempts available for the next hour.";

    res.status(200).json({
      message: responseMessage,
      remainingAttempts: remainingAttempts,
    });
  } catch (err) {
    console.error("Resend verification error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// Handle malformed social auth success
exports.malformedSocialAuthSuccess = (req, res) => {
  res.redirect("/login?error=malformed_oauth_redirect");
};

// Handle specific malformed Google auth
exports.specificMalformedGoogleAuth = (req, res) => {
  res.redirect("/login?error=malformed_google_auth");
};
