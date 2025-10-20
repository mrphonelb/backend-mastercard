require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Env vars
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

/* ======================================================
   💳 CREATE MASTERCARD SESSION — FINAL FIXED VERSION
   ====================================================== */
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
        operation: "PURCHASE", // ✅ Required for one-step sale
        merchant: {
          name: "Mr Phone Lebanon",
          url: "https://www.mrphonelb.com"
        },
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE",
          shipping: "HIDE"
        },
        // ⚠️ Do NOT include returnUrl or checkoutMode here!
      },
      order: {
        id: orderId,
        amount: Number(amount).toFixed(2),
        currency: currency,
        description: "Mr Phone Lebanon Online Purchase"
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

/* ======================================================
   🧠 HEALTH CHECK
   ====================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend ready for Mastercard Popup Checkout (v100).");
});

/* ======================================================
   🚀 START SERVER
   ====================================================== */
app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
