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

app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running for Mastercard Hosted Checkout.");
});

app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;
    if (!orderId || !amount) {
      return res.status(400).json({ error: "Missing orderId or amount" });
    }

    console.log(`💰 Creating Mastercard session for ${amount} ${currency} | Order: ${orderId}`);

    const url = `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`;
    const authHeader =
      "Basic " + Buffer.from(`merchant.${MERCHANT_ID}:${API_PASSWORD}`).toString("base64");

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      order: {
        id: orderId,
        amount: amount,
        currency: currency,
      },
      interaction: {
        operation: "AUTHORIZE",
        merchant: {
          name: "Mr Phone LB",
          url: "https://www.mrphonelb.com",
        },
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout",
      },
    };

    const { data } = await axios.post(url, payload, {
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
    });

    console.log("✅ MPGS session created successfully:", data);
    res.json(data);
  } catch (err) {
    console.error("❌ Failed to create Mastercard session:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create session",
      debug: err.response?.data || err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 MrPhone Backend live on port ${PORT}`);
});
