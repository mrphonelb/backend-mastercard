require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

const PORT = process.env.PORT || 10000;

// Health check
app.get("/", (req, res) => {
  res.send("✅ MrPhone Mastercard backend running.");
});

/* ===========================================================
   💳 INITIATE CHECKOUT SESSION
   =========================================================== */
app.post("/initiate-checkout", async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    console.log(`💰 Creating session for ${amount} USD | Draft: ${orderId}`);

    const url = `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`;

    const body = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "AUTHORIZE",
        merchant: {
          name: "Mr Phone LB"
        },
        // ✅ Redirect customer back to your Daftra checkout after payment
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout?paid=1"
      },
      order: {
        currency: "USD",
        amount: amount
      }
    };

    const authString = Buffer.from(`merchant.${process.env.MERCHANT_ID}:${process.env.API_PASSWORD}`).toString("base64");

    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authString}`
      }
    });

    console.log("✅ Session created:", response.data.session.id);
    res.json(response.data);
  } catch (err) {
    console.error("❌ MPGS error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create session",
      debug: err.response?.data || err.message
    });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
