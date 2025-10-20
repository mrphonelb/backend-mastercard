require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running for Mastercard Hosted Checkout.");
});

app.post("/create-mastercard-session", async (req, res) => {
  const { orderId, amount, currency } = req.body;
  console.log(`💰 Creating Mastercard session for ${amount} ${currency} | Order: ${orderId}`);

  try {
    const response = await axios.post(
      `${process.env.HOST}/api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",  // ✅ correct operation
        interaction: {
          operation: "PURCHASE",            // ✅ must be PURCHASE (not AUTHORIZE / NONE)
          returnUrl: "https://www.mrphonelb.com/client/contents/checkout", // ✅ redirect after success
          merchant: {
            name: "Mr Phone LB"             // ✅ merchant name only (no logo)
          },
          displayControl: {
            billingAddress: "HIDE"          // ✅ optional - hides billing address
          }
        },
        order: {
          id: orderId,                      // ✅ example: ORDER-1760978074268
          amount: amount,
          currency: currency || "USD"       // ✅ ensure USD
        }
      },
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD
        },
        headers: { "Content-Type": "application/json" }
      }
    );

    console.log("✅ Session Created Successfully:", response.data);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Mastercard Error:", error.response?.data || error.message);
    res.status(400).json({
      error: "Failed to create Mastercard session",
      debug: error.response?.data
    });
  }
});



app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
