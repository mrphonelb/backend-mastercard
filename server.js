require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Environment variables
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

/* ====================================================
   💳 Create Mastercard Checkout Session (FINAL WORKING)
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;

    if (!orderId || !amount || !currency) {
      return res.status(400).json({
        error: "Missing orderId, amount, or currency.",
      });
    }

    console.log(`💰 Creating Mastercard session for ${amount} ${currency} | Order: ${orderId}`);

    // ✅ Mastercard payload (v100+)
    const payload = {
      apiOperation: "CREATE_CHECKOUT_SESSION",
      order: {
        amount: Number(amount).toFixed(2),
        currency,
        description: "Mr Phone Lebanon Online Purchase",
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          url: "https://www.mrphonelb.com",
        },
        displayControl: {
          billingAddress: "HIDE",
          shipping: "HIDE",
          customerEmail: "HIDE",
        },
      },
    };

    // ✅ Order ID must be in the URL
    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${orderId}`,
      payload,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("✅ Mastercard Session Created:", response.data);
    res.json({
      result: response.data.result,
      session: response.data.session,
      successIndicator: response.data.successIndicator,
    });
  } catch (err) {
    console.error("❌ Mastercard Session Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create session",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   🧠 Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend ready for Mastercard Embedded Checkout (v100).");
});

/* ====================================================
   🚀 Start Server
   ==================================================== */
app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
