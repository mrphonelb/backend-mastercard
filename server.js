require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ====================================================
   🧱 CORS CONFIGURATION
   ==================================================== */
app.use(
  cors({
    origin: "*", // for testing; later restrict to your domain
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

/* ====================================================
   ✅ BASIC LOGGING
   ==================================================== */
app.use((req, res, next) => {
  // Skip repeated Render health checks or root GETs
  if (req.url === "/" && req.method === "GET") return next();

  const origin = req.headers.origin || "undefined";
  console.log(`➡️  ${req.method} ${req.url} | From Origin: ${origin}`);
  next();
});


/* ====================================================
   ⚙️ SERVER CONFIG
   ==================================================== */
const PORT = process.env.PORT || 10000;

// ⚠️ Replace with your own MPGS credentials
const MERCHANT_ID = process.env.MERCHANT_ID || "TESTMRPHONE";
const API_PASSWORD = process.env.API_PASSWORD || "YOUR_API_PASSWORD";
const API_URL = process.env.API_URL || "https://creditlibanais-netcommerce.gateway.mastercard.com/api/rest/version/72";

/* ====================================================
   🧠 HEALTH CHECK
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running — Mastercard Hosted Checkout Ready!");
});

/* ====================================================
   💳 INITIATE CHECKOUT SESSION
   ==================================================== */
app.post("/initiate-checkout", async (req, res) => {
  try {
    const { amount, currency, draftId, description, customer } = req.body;
    console.log(`💰 Creating session for ${amount} ${currency} | Draft: ${draftId}`);

    const response = await axios.post(
      `${API_URL}/merchant/${MERCHANT_ID}/session`,
      {
        apiOperation: "CREATE_CHECKOUT_SESSION",
        interaction: {
          operation: "PURCHASE",
          returnUrl: "https://www.mrphonelb.com/client/contents/checkout",
          merchant: {
            name: "Mr. Phone LB",
            logo: "https://www.mrphonelb.com/images/logo.png",
          },
        },
        order: {
          id: `ORDER-${draftId}`,
          amount: parseFloat(amount).toFixed(2),
          currency: currency || "USD",
          description: description || "Mr. Phone Checkout",
        },
        customer: {
          firstName: customer?.firstName || "Guest",
          lastName: customer?.lastName || "Customer",
          email: customer?.email || "guest@mrphonelb.com",
          mobilePhone: customer?.phone || "0000",
        },
      },
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    const session = response.data.session;
    console.log("✅ Session created:", session.id);
    res.json({ sessionId: session.id, successIndicator: session.successIndicator });
  } catch (err) {
    console.error("❌ Error creating session:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create payment session" });
  }
});

/* ====================================================
   🔄 PAYMENT CALLBACK (Optional)
   - If you configure a return URL or webhook in NetCommerce,
     this endpoint will handle success/failure
   ==================================================== */
app.post("/payment-callback", (req, res) => {
  console.log("📩 Received payment callback:", req.body);
  // Here you can handle order updates or notify Daftra
  res.status(200).send("✅ Callback received");
});

/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(PORT, () => {
  console.log(`🚀 MrPhone Backend running on port ${PORT}`);
});
