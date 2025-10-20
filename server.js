require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());

// ✅ Allow all origins for Daftra iframe / frontend
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

const port = process.env.PORT || 10000;
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;

/* ====================================================
   ✅ Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running for Mastercard Hosted Checkout.");
});

/* ====================================================
   💳 Create Mastercard Checkout Session
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  const { orderId, amount, currency } = req.body;

  if (!orderId || !amount) {
    return res.status(400).json({ error: "Missing orderId or amount" });
  }

  console.log(`💰 Creating Mastercard session for ${amount} ${currency || "USD"} | Order: ${orderId}`);

  try {
    const url = `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`;
    const authHeader =
      "Basic " + Buffer.from(`merchant.${MERCHANT_ID}:${API_PASSWORD}`).toString("base64");

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone LB"
        },
        // ✅ Return back to same origin (so /card_payment can close itself)
        returnUrl: "https://www.mrphonelb.com/contents/process_content/card_payment"
      },
      order: {
        id: orderId,
        amount: parseFloat(amount),
        currency: currency || "USD"
      }
    };

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json"
      }
    });

    console.log("✅ Session Created Successfully:", response.data);
    res.json(response.data);

  } catch (err) {
    console.error("❌ MPGS error:", err.response?.data || err.message);
    res.status(400).json({
      error: "Failed to create session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   🧠 Start server
   ==================================================== */
app.listen(port, () =>
  console.log(`🚀 MrPhone Backend running on port ${port}`)
);
