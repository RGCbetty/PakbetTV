const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs").promises;
const https = require("https");
const http = require("http");
const db = require("../config/db");

// Create reusable transporter object using SMTP transport with connection pooling
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Enable connection pooling for better performance
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  // Keep connections alive
  connectionTimeout: 60000,
  greetingTimeout: 30000,
  socketTimeout: 60000,
});

// Function to format price with right alignment
const formatPrice = (price) => {
  return `₱${Number(price).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

// Dynamic API base URL based on environment
const API_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://api.michaeldemesa.com"
    : process.env.API_BASE_URL || "http://localhost:5000";

// Function to generate common footer HTML
const generateFooterHtml = () => `
  <div class="footer" style="background-color:#162447; text-align:center; margin-top:30px; padding:25px 15px; font-size:12px; color:#ffffff;">
    <h3 style="color:#ffffff; margin:0 0 10px 0;">Get in Touch</h3>
    <p style="margin:0 0 20px 0; color:#ffffff;">For any questions please send an email to <a href="mailto:hello@michaeldemesa.com" style="color:#ffffff; text-decoration:underline;">hello@michaeldemesa.com</a></p>
    <p style="margin:0;">
      <a href="https://www.facebook.com/pakbettv" style="color:#ffffff; text-decoration:none; margin:0 10px;">Facebook</a> |
      <a href="https://www.tiktok.com/@pakbettv.com?is_from_webapp=1&sender_device=pc" style="color:#ffffff; text-decoration:none; margin:0 10px;">TikTok</a> |
      <a href="https://www.instagram.com/pakbettv/" style="color:#ffffff; text-decoration:none; margin:0 10px;">Instagram</a> |
      <a href="https://www.youtube.com/@PakBetTV" style="color:#ffffff; text-decoration:none; margin:0 10px;">YouTube</a>
    </p>
  </div>
`;

// Update all email templates to use the common footer
const generateEmailTemplate = (content) => `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <meta name="x-apple-disable-message-reformatting" />
      <title>Email</title>
      <style>
        .price-column {
          text-align: right;
          min-width: 120px;
          display: inline-block;
        }
      </style>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin:0; padding:0;">
      <div style="max-width:600px; margin:0 auto; padding:20px;">
        <div style="text-align:center; margin-bottom:30px;">
          <img src="cid:emailHeader" alt="Email Header" style="width:100%; max-width:600px; height:auto;" />
        </div>
        <div style="margin-bottom:30px;">
          ${content}
        </div>
        ${generateFooterHtml()}
      </div>
    </body>
  </html>
`;

// Function to get email header attachment
const getEmailHeaderAttachment = () => ({
  filename: "Michael De Mesa Feng Shui Consultancy-header.png",
  path: path.join(__dirname, "../../client/public/Emailheader-Latest.png"),
  cid: "emailHeader",
  contentDisposition: "inline",
});

// Simplified function to send order confirmation email (without product images)
const sendOrderConfirmationEmail = async (orderDetails) => {
  const {
    orderNumber,
    customerName,
    customerEmail,
    customerPhone,
    items,
    totalAmount,
    shippingFee = 0,
    discount = 0,
    shippingAddress,
    paymentMethod,
    paymentReference,
    trackingNumber,
  } = orderDetails;

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const calculatedTotal = subtotal + shippingFee - discount;

  // Only include header image attachment (no product images)
  const attachments = [getEmailHeaderAttachment()];

  // Generate items HTML without images
  const itemsHtml = items
    .map((item) => {
      return `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">
          <span>${item.name}</span>
        </td>
        <td style="padding: 8px; text-align: right; border: 1px solid #ddd; width: 100px;">${
          item.quantity
        }</td>
        <td style="padding: 8px; text-align: right; border: 1px solid #ddd; width: 120px;">₱${item.price.toFixed(
          2
        )}</td>
      </tr>
    `;
    })
    .join("");

  const content = `
    <h2>Order Confirmation</h2>
    <p>Dear ${customerName},</p>
    <p>Thank you for your order! We're pleased to confirm that your order has been received and is being processed.</p>
    
    <h3>Order Information:</h3>
    <p><strong>Order Number:</strong> ${orderNumber}</p>
    <p><strong>Payment Method:</strong> ${paymentMethod}</p>
    <p><strong>Payment Reference:</strong> ${paymentReference}</p>
    
    <h3>Items Ordered:</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
      <thead>
        <tr style="background-color:#f5f5f5;">
          <th style="text-align:left; padding:8px; border:1px solid #ddd;">Product</th>
          <th style="text-align:right; padding:8px; border:1px solid #ddd; width: 100px;">Quantity</th>
          <th style="text-align:right; padding:8px; border:1px solid #ddd; width: 120px;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <table style="width:100%; max-width:300px; margin-left:auto;">
      <tr>
        <td style="padding:4px 0; text-align:left;">Subtotal:</td>
        <td style="padding:4px 0; text-align:right; width:120px;">₱${subtotal.toFixed(
          2
        )}</td>
      </tr>
      ${
        discount > 0
          ? `
      <tr>
        <td style="padding:4px 0; text-align:left;">Discount:</td>
        <td style="padding:4px 0; text-align:right;">-₱${discount.toFixed(
          2
        )}</td>
      </tr>
      `
          : ""
      }
      <tr>
        <td style="padding:4px 0; text-align:left;">Shipping:</td>
        <td style="padding:4px 0; text-align:right;">₱${shippingFee.toFixed(
          2
        )}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0; border-bottom:1px solid #000;"></td>
      </tr>
      <tr>
        <td style="padding:4px 0; text-align:left; font-weight:bold;">Total:</td>
        <td style="padding:4px 0; text-align:right; font-weight:bold;">₱${calculatedTotal.toFixed(
          2
        )}</td>
      </tr>
    </table>

    <div class="shipping-info" style="margin-top:30px;">
      <h3>Shipping Details:</h3>
      <p><strong>Delivery Address:</strong><br/>${shippingAddress}</p>
      ${
        trackingNumber
          ? `
        <div class="tracking-info" style="background-color: #f9f9f9; padding: 15px; margin: 20px 0;">
          <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
          <p>You can track your order using this tracking number on our website.</p>
        </div>
      `
          : ""
      }
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"MICHAEL DE MESA - BAZI & FENG SHUI CONSULTANCY" <${process.env.SMTP_USER}>`,
      to: customerEmail,
      subject: `Order Confirmation #${orderNumber}`,
      html: generateEmailTemplate(content),
      attachments: attachments,
    });

    console.log("Order confirmation email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Order confirmation email error:", error.message);
    return { success: false, error: error.message };
  }
};

// Simplified review request email (without product images)
const sendReviewRequestEmail = async (details) => {
  const { orderNumber, customerName, customerEmail, items = [] } = details;

  const FRONTEND_BASE_URL =
    process.env.FRONTEND_BASE_URL || "https://michaeldemesa.com";
  const attachments = [getEmailHeaderAttachment()];

  // Generate items HTML without images
  const itemsHtml = items.map((item) => {
    return `
      <li style="display:flex; align-items:center; margin-bottom:16px; background-color:#ffffff; border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,0.08); padding:12px;">
        <div style="flex:1;">
          <p style="margin:0 0 8px 0; font-weight:600; color:#333333; font-size:14px;">${item.name}</p>
          <a href="${FRONTEND_BASE_URL}/product/${item.product_id}" target="_blank" style="background-color:#FEC16E; color:#000000; padding:6px 14px; text-decoration:none; border-radius:4px; font-size:12px; display:inline-block;">Leave a Review</a>
        </div>
      </li>
    `;
  });

  const content = `
    <h2>Order Review Request</h2>
    <p>Hi ${customerName},</p>
    <p>Once again, thanks for ordering online from PakBet TV and we look forward to serving you again soon!</p>
    
    <div class="review-request" style="background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p>Please rate your overall satisfaction with your experience online and spare a moment to leave some product review and feedback.</p>
      <p style="color: #666;"><em>As a token of our appreciation, PakBet TV will give you a surprise coupon code that you can use on your next purchase!</em></p>
    </div>

    <h3>Your Products:</h3>
    <ul style="padding-left: 0; list-style: none;">
      ${itemsHtml.join("")}
    </ul>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${FRONTEND_BASE_URL}" 
         target="_blank" 
         style="background-color: #FEC16E; 
                color: #000000; 
                padding: 12px 28px; 
                text-decoration: none; 
                border-radius: 6px; 
                font-weight: bold; 
                display: inline-block;">
        Shop More Feng Shui Items
      </a>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"MICHAEL DE MESA - BAZI & FENG SHUI CONSULTANCY" <${process.env.SMTP_USER}>`,
      to: customerEmail,
      subject: `How was your order #${orderNumber}? Leave a review`,
      html: generateEmailTemplate(content),
      attachments: attachments,
    });

    console.log("Review request email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error("Review email error:", err.message);
    return { success: false, error: err.message };
  }
};

// Contact form email - updated to use hello@michaeldemesa.com
const sendContactFormEmail = async (contactDetails) => {
  const { name, email, phone, message } = contactDetails;

  const content = `
    <h2>New Contact Form Submission</h2>
    <p>Dear Admin,</p>
    <p>You have received a new message from your website contact form.</p>
    
    <h3>Contact Information:</h3>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Phone:</strong> ${phone}</p>
    
    <div class="tracking-info" style="background-color: #f9f9f9; padding: 15px; margin: 20px 0;">
      <h3>Message:</h3>
      <p>${message.replace(/\n/g, "<br>")}</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"MICHAEL DE MESA - BAZI & FENG SHUI CONSULTANCY" <${process.env.SMTP_USER}>`,
      to: "hello@michaeldemesa.com",
      replyTo: email,
      subject: `New Contact Form Message from ${name}`,
      html: generateEmailTemplate(content),
      attachments: [getEmailHeaderAttachment()],
    });

    console.log("Contact form email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Contact form email error:", error.message);
    return { success: false, error: error.message };
  }
};

// Appointment request email - updated to use hello@michaeldemesa.com
const sendAppointmentRequestEmail = async (appointmentDetails) => {
  const { name, email, phone, message, subject } = appointmentDetails;

  const content = `
    <h2>New Appointment Request</h2>
    <p>Dear Admin,</p>
    <p>You have received a new appointment request from your website consultation form.</p>
    
    <h3>Client Information:</h3>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Phone:</strong> ${phone}</p>
    <p><strong>Subject:</strong> ${subject || "Appointment Request"}</p>
    
    <div class="tracking-info" style="background-color: #f9f9f9; padding: 15px; margin: 20px 0;">
      <h3>Appointment Details:</h3>
      <p>${message.replace(/\n/g, "<br>")}</p>
    </div>
    
    <div class="important-note" style="background-color: #fff3e0; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0;"><strong>Action Required:</strong></p>
      <p style="margin: 10px 0 0 0;">Please review this appointment request and respond to the client with available consultation schedules.</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"MICHAEL DE MESA - BAZI & FENG SHUI CONSULTANCY" <${process.env.SMTP_USER}>`,
      to: "hello@michaeldemesa.com",
      replyTo: email,
      subject: `New Appointment Request from ${name}`,
      html: generateEmailTemplate(content),
      attachments: [getEmailHeaderAttachment()],
    });

    console.log("Appointment request email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Appointment request email error:", error.message);
    return { success: false, error: error.message };
  }
};

const sendPasswordResetEmail = async (email, resetToken, origin) => {
  const resetUrl = `${origin}/reset-password/${resetToken}`;

  const content = `
    <h2>Reset Your Password</h2>
    <p>Dear Valued Customer,</p>
    <p>You recently requested to reset your password. We're here to help you regain access to your account.</p>
    
    <h3>Reset Information:</h3>
    <p><strong>Request Time:</strong> ${new Date().toLocaleString()}</p>
    <p><strong>Expires In:</strong> 1 hour</p>
    
    <div class="tracking-info" style="background-color: #f9f9f9; padding: 15px; margin: 20px 0;">
      <h3>Reset Instructions:</h3>
      <p>Click the button below to proceed with your password reset:</p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${resetUrl}" 
           style="background-color: #FEC16E; 
                  color: #000000; 
                  padding: 12px 28px; 
                  text-decoration: none; 
                  border-radius: 6px; 
                  font-weight: bold;">
          Reset Password
        </a>
      </div>
      <p>If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
      <p>Alternatively, you can copy and paste this URL into your browser:</p>
      <p style="word-break: break-all; background-color: #f0f0f0; padding: 10px; border-radius: 4px;">${resetUrl}</p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"MICHAEL DE MESA - BAZI & FENG SHUI CONSULTANCY" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Password Reset Request",
      html: generateEmailTemplate(content),
      attachments: [getEmailHeaderAttachment()],
    });

    console.log("Password reset email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Password reset email error:", error.message);
    return { success: false, error: error.message };
  }
};

const sendOrderDispatchedEmail = async (details) => {
  const { customerName, customerEmail, trackingNumber } = details;

  const trackingLink = `https://www.ninjavan.co/en-ph/tracking?id=${encodeURIComponent(
    trackingNumber
  )}`;

  const content = `
    <h2>Your Order is On Its Way!</h2>
    <p>Hi ${customerName},</p>
    <p>Get excited — your order is on its way Ka-PakBet!</p>
    <p>We are pleased to inform you that your order has been dispatched today and you'll receive it soon.</p>

    <div class="tracking-info" style="background-color: #f9f9f9; padding: 15px; margin: 20px 0; text-align: center;">
      <p><strong>Tracking Number:</strong><br/>
        <a href="${trackingLink}" target="_blank" style="color: #0066cc; text-decoration: none;">${trackingNumber}</a>
      </p>
    </div>

    <h3>Estimated Delivery Time:</h3>
    <ul style="padding-left: 20px; margin: 0;">
      <li style="margin-bottom: 8px;">Metro Manila – 1-4 working days</li>
      <li style="margin-bottom: 8px;">Luzon – 2-7 working days</li>
      <li style="margin-bottom: 8px;">Visayas – 4-8 working days</li>
      <li style="margin-bottom: 8px;">Mindanao – 7-12 working days</li>
    </ul>

    <div class="important-note" style="background-color: #fff3e0; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0;"><strong>Important Note:</strong></p>
      <p style="margin: 10px 0 0 0;">The courier will notify you via SMS once your order is out for delivery that day.</p>
      <p style="margin: 10px 0 0 0;">The courier will <u>only</u> attempt to deliver your order twice. Make sure someone can receive the parcel once the courier notifies you.</p>
      <p style="margin: 10px 0 0 0;">Please coordinate directly with the rider for status updates and faster delivery.</p>
    </div>

    <p>Thanks for shopping with us Ka-PakBet!</p>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"MICHAEL DE MESA - BAZI & FENG SHUI CONSULTANCY" <${process.env.SMTP_USER}>`,
      to: customerEmail,
      subject: "Your order is on its way!",
      html: generateEmailTemplate(content),
      attachments: [getEmailHeaderAttachment()],
    });

    console.log("Dispatched email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Dispatched email error:", error.message);
    return { success: false, error: error.message };
  }
};

// Send email verification email
const sendEmailVerification = async (
  email,
  verificationToken,
  userFirstName
) => {
  const FRONTEND_BASE_URL =
    process.env.FRONTEND_BASE_URL || "https://michaeldemesa.com";
  const verificationUrl = `${FRONTEND_BASE_URL}/verify-email/${verificationToken}`;

  const content = `
    <h2>Welcome to MICHAEL DE MESA - BAZI & FENG SHUI CONSULTANCY!</h2>
    <p>Hi ${userFirstName},</p>
    <p>Thank you for creating an account with us! To complete your registration and access all features, please verify your email address.</p>
    
    <div class="verification-info" style="background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <h3>Verification Required:</h3>
      <p>Please click the button below to verify your email address and activate your account:</p>
    </div>
    
    <div style="text-align: center; margin: 20px 0;">
      <a href="${verificationUrl}" 
         style="background-color: #A2201A; 
                color: #ffffff; 
                padding: 12px 28px; 
                text-decoration: none; 
                border-radius: 6px; 
                font-weight: bold;
                display: inline-block;">
        Verify Email Address
      </a>
    </div>
    
    <div class="important-note" style="background-color: #fff3e0; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0;"><strong>Important:</strong></p>
      <p style="margin: 10px 0 0 0;">This verification link will expire in 24 hours for security reasons.</p>
      <p style="margin: 10px 0 0 0;">Until your email is verified, you won't be able to access shopping features, place orders, or use other account functions.</p>
    </div>
    
    <p>If you did not create this account, please ignore this email or contact our support team.</p>
    <p>Alternatively, you can copy and paste this URL into your browser:</p>
    <p style="word-break: break-all; background-color: #f0f0f0; padding: 10px; border-radius: 4px;">${verificationUrl}</p>
    
    <p>Welcome to our community Ka-PakBet!</p>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"MICHAEL DE MESA - BAZI & FENG SHUI CONSULTANCY" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Verify Your Email Address - Account Activation Required",
      html: generateEmailTemplate(content),
      attachments: [getEmailHeaderAttachment()],
    });

    console.log("Email verification sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Email verification error:", error.message);
    return { success: false, error: error.message };
  }
};

// Test function remains the same
const sendTestEmail = async (recipientEmail) => {
  const sampleOrderDetails = {
    orderNumber: "TEST123",
    customerName: "John Doe",
    customerEmail: recipientEmail,
    customerPhone: "+63 912 345 6789",
    items: [
      { name: "Lucky Bamboo Plant", quantity: 2, price: 250.0 },
      { name: "Crystal Ball", quantity: 1, price: 599.0 },
    ],
    totalAmount: 1099.0,
    shippingFee: 150.0,
    shippingAddress:
      "123 Test Street, Makati City, Metro Manila, Philippines, 1234",
    paymentMethod: "DragonPay",
    paymentReference: "DP123456789",
    trackingNumber: "TRACK123456789",
  };

  return sendOrderConfirmationEmail(sampleOrderDetails);
};

// Cleanup function to close connections gracefully
const cleanup = async () => {
  console.log("Starting email service cleanup...");
  try {
    // Wait for any pending email operations to complete (up to 5 seconds)
    await new Promise((resolve) => {
      const checkPool = () => {
        if (transporter.isIdle()) {
          resolve();
        } else {
          console.log("Waiting for email operations to complete...");
          setTimeout(checkPool, 500);
        }
      };
      checkPool();
    }).then(() => {
      transporter.close();
      console.log("Email service cleanup completed");
    });
  } catch (error) {
    console.error("Error during cleanup:", error);
    // Ensure we still close connections even if there's an error
    try {
      transporter.close();
    } catch (e) {
      console.error("Error during forced cleanup:", e);
    }
  }
};

// Handle process termination
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, starting cleanup...");
  await cleanup();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, starting cleanup...");
  await cleanup();
  process.exit(0);
});

module.exports = {
  sendOrderConfirmationEmail,
  sendTestEmail,
  sendContactFormEmail,
  sendAppointmentRequestEmail,
  sendPasswordResetEmail,
  sendOrderDispatchedEmail,
  sendEmailVerification,
  sendReviewRequestEmail,
  cleanup,
};
