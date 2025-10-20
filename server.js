require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

const PORT = process.env.PORT || 10000;

/* =========================================================
   ✅ STEP 1 — INITIATE CHECKOUT SESSION
   ========================================================= */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency = "USD", description = "Mr Phone LB Order" } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({ error: "Missing orderId or amount" });
    }

    const merchantId = process.env.MERCHANT_ID;
    const apiPassword = process.env.API_PASSWORD;
    const auth = Buffer.from(`merchant.${merchantId}:${apiPassword}`).toString("base64");

    const url = `https://creditlibanais-netcommerce.gateway.mastercard.com/api/rest/version/100/merchant/${merchantId}/session`;

    const body = {
      apiOperation: "INITIATE_CHECKOUT",
      order: {
        id: orderId,
        amount: amount,
        currency: currency,
        description: description,
      },
      interaction: {
        operation: "PAY", // Authorize + Capture in one step
        merchant: {
          name: "Mr Phone LB",
          url: "https://www.mrphonelb.com",
        },
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout?paid=1",
      },
    };

    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
    });

    res.json(response.data);
  } catch (err) {
    console.error("❌ Mastercard INITIATE error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message,
    });
  }
});

/* =========================================================
   🧠 Health Check
   ========================================================= */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running for Mastercard Hosted Checkout.");
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
