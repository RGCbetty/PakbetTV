const nodemailer = require("nodemailer");
const db = require("../config/db");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "godbetty3@gmail.com",
    pass: "vdmh xjnk payk mowh", // Use App Password, not Gmail password
  },
});
// Handler for POST /api/subscribe
async function sendSubcriptionEmail(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    // 1. Check if already subscribed
    const [rows] = await db.query(
      "SELECT id FROM subscribers WHERE email = ?",
      [email]
    );

    if (rows.length > 0) {
      return res
        .status(400)
        .json({ message: "This email is already subscribed." });
    }

    // 2. Insert new subscriber
    await db.query("INSERT INTO subscribers (email) VALUES (?)", [email]);

    // 3. Send confirmation email
    await transporter.sendMail({
      from: '"Michael De Mesa Feng Shui" <your_email@gmail.com>',
      to: email,
      subject: "🎉 Thank you for subscribing to our Feng Shui Newsletter!",
      html: `
      <div style="background-color:#b30000; padding:40px; font-family:Arial, sans-serif; text-align:center; color:#fff;">
        
        <h1 style="color:#FFD700; margin-bottom:20px;">🎉 Welcome to the Family!</h1>
        
        <p style="font-size:16px; line-height:1.6;">
          Thank you for subscribing to our <b style="color:#FFD700;">Feng Shui Newsletter</b>!  
          You’ll now receive <b>exclusive Feng Shui tips</b>, <b>Zodiac insights</b>, and  
          <b>special promotions</b> directly in your inbox.
        </p>

        <p style="font-size:16px; margin:20px 0; color:#FFD700;">
          As a token of appreciation, here’s your <b>10% OFF code:</b>
        </p>

        <div style="background:#FFD700; color:#000; font-weight:bold; padding:12px 25px; 
                    border-radius:5px; display:inline-block; font-size:18px; margin-bottom:30px;">
          FS10OFF
        </div>

        <p style="font-size:14px; margin:15px 0 30px; color:#f0f0f0;">
          Apply this code on your next purchase at checkout.
        </p>

        <a href="https://your-shop-link.com" 
           style="background-color:#FFD700; color:#000; text-decoration:none; 
           padding:14px 30px; border-radius:5px; font-weight:bold; font-size:16px;">
          Go to Shop
        </a>

        <div style="margin-top:40px; font-size:12px; color:#ccc;">
          You are receiving this email because you subscribed on our website.<br>
          <a href="https://your-unsubscribe-link.com" style="color:#FFD700; text-decoration:none;">Unsubscribe</a>
        </div>
      </div>
    `,
    });

    res.json({ message: "Subscription successful", email });
  } catch (err) {
    console.error("Subscription error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  sendSubcriptionEmail,
};
