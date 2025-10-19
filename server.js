require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ============================================
   🌐 1. CORS & JSON Middleware
   ============================================ */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options(/.*/, cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

const port = process.env.PORT || 3000;

/* ============================================
   🩺 2. Health Check
   ============================================ */
app.get("/", (_, res) => {
  res.send("✅ MrPhone Backend is running for Mastercard Hosted Checkout!");
});

/* ============================================
   💳 3. INITIATE CHECKOUT – Create Mastercard Session
   ============================================ */
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency = "USD", draftId, description, customer } = req.body;
  const orderId = draftId || `ORDER-${Date.now()}`;

  try {
    console.log(`💳 Initiating Mastercard session for ${orderId}`);

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
          returnUrl: `https://mrphone-backend.onrender.com/payment-result/${orderId}`,
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
          description: description || `Order #${orderId} - Mr. Phone Lebanon`,
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

/* ============================================
   💰 4. PAYMENT RESULT – Verify + Create Daftra Invoice
   ============================================ */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    console.log(`🔍 Verifying order ${orderId}...`);

    const verify = await axios.get(
      `${process.env.HOST}api/rest/version/100/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    const result = verify.data.result?.toUpperCase() || "UNKNOWN";
    console.log(`💬 Payment result for ${orderId}: ${result}`);

    if (result === "SUCCESS") {
      // ✅ Create Daftra paid invoice
      const daftra = await axios.post(
        "https://www.daftra.com/v2/api/entity/invoice",
        {
          draft: false,
          name: `Invoice for ${orderId}`,
          currency: "USD",
          status: "paid",
          items: [{ name: "Online Order", price: verify.data.amount, qty: 1 }],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.DAFTRA_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const invoiceId = daftra.data.id;
      console.log("✅ Daftra invoice created:", invoiceId);
      return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoiceId}`);
    } else {
      console.warn("❌ Payment failed or not completed");
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${orderId}`);
    }
  } catch (err) {
    console.error("❌ Verification or invoice creation failed:", err.message);
    return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${orderId}`);
  }
});

/* ============================================
   🚀 5. Start Server
   ============================================ */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
