require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("✅ Mastercard Backend running.");
});

/* =====================================================
   💳 INITIATE CHECKOUT (CREATE SESSION)
   ===================================================== */
app.post("/initiate-checkout", async (req, res) => {
  try {
    const { amount } = req.body;

    const url = `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`;

    const body = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "AUTHORIZE",
        merchant: { name: "Mr Phone LB" },
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout?paid=1"
      },
      order: {
        amount: amount,
        currency: "USD"
      }
    };

    const auth = Buffer.from(
      `merchant.${process.env.MERCHANT_ID}:${process.env.API_PASSWORD}`
    ).toString("base64");

    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`
      }
    });

    console.log("✅ Session Created:", response.data.session.id);
    res.json(response.data);
  } catch (error) {
    console.error("❌ MPGS error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to create session",
      debug: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
