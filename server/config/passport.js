const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const FacebookStrategy = require("passport-facebook").Strategy;
const db = require("./db");
const bcrypt = require("bcryptjs");
require("dotenv").config({ path: "../../.env" }); // 👈 Make sure this is here

// Serialize user for the session
passport.serializeUser((user, done) => {
  done(null, user.user_id);
});

// Deserialize user from the session
passport.deserializeUser(async (id, done) => {
  try {
    const [users] = await db.query(
      "SELECT user_id, first_name, last_name, email, user_type, status FROM users WHERE user_id = ?",
      [id]
    );

    if (users.length === 0) {
      return done(null, false);
    }

    done(null, users[0]);
  } catch (error) {
    done(error, null);
  }
});

// Helper function to find or create user from social profile
const findOrCreateUser = async (profile, provider, done) => {
  try {
    // Check if user exists with this social ID
    const [existingUsersBySocialId] = await db.query(
      `SELECT * FROM users WHERE ${provider}_id = ?`,
      [profile.id]
    );

    if (existingUsersBySocialId.length > 0) {
      return done(null, existingUsersBySocialId[0]);
    }

    // Check if user exists with this email
    const [existingUsersByEmail] = await db.query(
      "SELECT * FROM users WHERE email = ?",
      [profile.emails[0].value]
    );

    if (existingUsersByEmail.length > 0) {
      // Update user with social ID
      const user = existingUsersByEmail[0];
      await db.query(`UPDATE users SET ${provider}_id = ? WHERE user_id = ?`, [
        profile.id,
        user.user_id,
      ]);
      return done(null, user);
    }

    // Create new user from social profile
    const [displayName, ...rest] = profile.displayName.split(" ");
    const firstName = profile.name?.givenName || displayName || "";
    const lastName = profile.name?.familyName || rest.join(" ") || "";
    const email = profile.emails[0].value;

    // Generate random password for social media users
    const password = Math.random().toString(36).slice(-10);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert new user
    const [result] = await db.query(
      `INSERT INTO users 
      (first_name, last_name, username, email, password, user_type, status, ${provider}_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firstName,
        lastName,
        `${firstName.toLowerCase()}_${Math.floor(Math.random() * 10000)}`,
        email,
        hashedPassword,
        "Customer",
        "Active",
        profile.id,
      ]
    );

    const [newUser] = await db.query("SELECT * FROM users WHERE user_id = ?", [
      result.insertId,
    ]);

    return done(null, newUser[0]);
  } catch (error) {
    return done(error, null);
  }
};

// Google Strategy Configuration - Only if environment variables are available
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const callbackURL =
    process.env.NODE_ENV === "production"
      ? "https://michaeldemesa.com/api/auth/google/callback"
      : "/api/auth/google/callback";

  console.log("Configuring Google OAuth with callback URL:", callbackURL);
  console.log(
    "GOOGLE_CLIENT_ID:",
    process.env.GOOGLE_CLIENT_ID ? "Set" : "Not set"
  );

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: callbackURL,
        profileFields: ["id", "displayName", "name", "emails", "photos"],
      },
      (accessToken, refreshToken, profile, done) => {
        console.log("Google OAuth callback triggered for user:", profile.id);
        findOrCreateUser(profile, "google", done);
      }
    )
  );
} else {
  console.log(
    "Google OAuth not configured - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables missing"
  );
}

// Facebook Strategy Configuration - Only if environment variables are available
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: "/api/auth/facebook/callback",
        profileFields: ["id", "displayName", "name", "emails", "photos"],
        enableProof: true,
      },
      (accessToken, refreshToken, profile, done) => {
        // Ensure we have an email
        if (!profile.emails || !profile.emails[0]?.value) {
          return done(
            new Error(
              "Email is required for registration. Please ensure you grant email permission."
            )
          );
        }
        findOrCreateUser(profile, "facebook", done);
      }
    )
  );
} else {
  console.log(
    "Facebook OAuth not configured - FACEBOOK_APP_ID and FACEBOOK_APP_SECRET environment variables missing"
  );
}

module.exports = passport;
