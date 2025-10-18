require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ============================================================
   ✅ CORS CONFIGURATION — allow Daftra domain only
   ============================================================ */
app.use(
  cors({
    origin: [
      "https://www.mrphonelb.com", // your live Daftra website
      "https://mrphonelb.com",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

const port = process.env.PORT || 3000;

/* ============================================================
   🧠 HEALTH CHECK
   ============================================================ */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend is running and ready for Mastercard Hosted Checkout!");
});

/* ============================================================
   💳 INITIATE CHECKOUT — create Mastercard payment session
   ============================================================ */
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency = "USD", draftId, description, customer } = req.body;
  const orderId = draftId || `ORDER-${Date.now()}`;

  try {
    console.log("🧾 Creating Mastercard session for order:", orderId);

    const response = await axios.post(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "INITIATE_CHECKOUT",
        interaction: {
          operation: "PURCHASE",
          merchant: {
            name: "Mr. Phone Lebanon",
            url: "https://www.mrphonelb.com",
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          },
          locale: "en_US",
          returnUrl: `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${orderId}`,
          cancelUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=${orderId}`,
          displayControl: {
            billingAddress: "HIDE",
            shipping: "HIDE",
            customerEmail: "HIDE",
          },
        },
        order: {
          id: orderId,
          amount,
          currency,
          description: description || `Checkout Order #${orderId} - Mr. Phone Lebanon`,
        },
        customer: {
          firstName: customer?.firstName || "Guest",
          lastName: customer?.lastName || "Customer",
          email: customer?.email || "guest@mrphonelb.com",
          mobilePhone: customer?.phone || "00000000",
        },
      },
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("✅ Mastercard session created:", response.data.session.id);

    res.json({
      sessionId: response.data.session.id,
      successIndicator: response.data.successIndicator,
      orderId,
    });
  } catch (error) {
    console.error("❌ INITIATE_CHECKOUT failed:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      details: error.response?.data || error.message,
    });
  }
});

/* ============================================================
   🧾 RETRIEVE ORDER STATUS — verify payment result (optional)
   ============================================================ */
app.get("/retrieve-order/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const response = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    const data = response.data;
    res.json({
      orderId: data.id,
      amount: data.amount,
      currency: data.currency,
      result: data.result || "UNKNOWN",
      status: data.status || "UNKNOWN",
      gatewayCode: data.response?.gatewayCode || "NONE",
    });
  } catch (error) {
    console.error("❌ Retrieve Order Error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to retrieve order",
      details: error.response?.data || error.message,
    });
  }
});

/* ============================================================
   🚀 START SERVER
   ============================================================ */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
