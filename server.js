require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Environment Variables
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

/* ============================================================
   💳 Create Mastercard Checkout Session (Final Fixed Version)
   ============================================================ */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;

    if (!orderId || !amount || !currency) {
      return res.status(400).json({ error: "Missing orderId, amount, or currency." });
    }

    console.log(`💰 Creating Mastercard session for ${amount} ${currency} | Order: ${orderId}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE", // ✅ direct sale
        merchant: { name: "Mr Phone LB" },
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE"
        }
      },
      order: {
        id: orderId,
        amount: Number(amount).toFixed(2),
        currency: currency,
        description: "MrPhoneLB Secure Online Purchase"
      }
    };

    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    console.log("✅ Mastercard Session Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Mastercard Session Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create session",
      debug: err.response?.data || err.message
    });
  }
});

/* ============================================================
   🧠 Health Check
   ============================================================ */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running for Mastercard Hosted Checkout (Popup version).");
});

/* ============================================================
   🚀 Start Server
   ============================================================ */
app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
