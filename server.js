require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const HOST = process.env.HOST; // https://creditlibanais-netcommerce.gateway.mastercard.com/
const MERCHANT_ID = process.env.MERCHANT_ID; // TEST06263500
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// Health-check
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running for Mastercard Hosted Checkout.");
});

// Create Hosted Checkout Session
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;
    if (!orderId || !amount || !currency)
      return res.status(400).json({ error: "Missing orderId, amount, or currency" });

    console.log(`💳 Creating session for ${amount} ${currency} | Order ${orderId}`);

    const url = `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`;
    const auth =
      "Basic " + Buffer.from(`merchant.${MERCHANT_ID}:${API_PASSWORD}`).toString("base64");

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE", // or AUTHORIZE if you capture later
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout",
        merchant: { name: "Mr Phone LB", url: "https://www.mrphonelb.com" }
      },
      order: { id: orderId, amount: amount, currency: currency }
    };

    const { data } = await axios.post(url, payload, {
      headers: { Authorization: auth, "Content-Type": "application/json" }
    });

    console.log("✅ Session created:", data);
    res.json(data);
  } catch (err) {
    console.error("❌ Session creation failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create session", debug: err.response?.data });
  }
});

app.listen(PORT, () => console.log(`🚀 Backend live on port ${PORT}`));
