require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ====================================================
   🧩 BASIC CONFIG
   ==================================================== */
app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.options("*", cors());

app.use((req, res, next) => {
  console.log(`➡️  ${req.method} ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;

/* ====================================================
   ✅ HEALTH CHECK
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running for Mastercard Hosted Checkout.");
});

/* ====================================================
   💳 CREATE MASTERCARD SESSION
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;

    if (!orderId || !amount) {
      console.error("❌ Missing orderId or amount in request body");
      return res.status(400).json({ error: "Missing orderId or amount" });
    }

    console.log(`💰 Creating Mastercard session for ${amount} ${currency || "USD"} | Order: ${orderId}`);

    // Payload following NetCommerce INITIATE_CHECKOUT schema
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE",
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout"
      },
      order: {
        id: orderId,
        amount: parseFloat(amount).toFixed(2),
        currency: currency || "USD"
      }
    };

    // API endpoint
    const endpoint = `${process.env.HOST}/api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`;

    // POST request
    const response = await axios.post(endpoint, payload, {
      auth: {
        username: `merchant.${process.env.MERCHANT_ID}`,
        password: process.env.API_PASSWORD
      },
      headers: { "Content-Type": "application/json" }
    });

    console.log("✅ Session Created Successfully:", response.data);

    res.json(response.data);
  } catch (error) {
    const errData = error.response?.data || error.message;
    console.error("❌ MPGS session creation failed:", errData);

    res.status(400).json({
      error: "Failed to create session",
      debug: errData
    });
  }
});

/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
