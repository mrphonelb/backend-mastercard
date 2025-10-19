require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

/* ====================================================
   🌐 SECURE CORS SETUP
   ==================================================== */
app.use(
  cors({
    origin: [
      "https://www.mrphonelb.com",
      "https://mrphone-backend.onrender.com",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "APIKEY"],
  })
);
app.options("*", cors());
app.use(express.json());

/* ====================================================
   🛰️ LOG REQUESTS
   ==================================================== */
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url} | Origin: ${req.headers.origin}`);
  next();
});

const port = process.env.PORT || 3000;

/* ====================================================
   🩺 HEALTH CHECK
   ==================================================== */
app.get("/", (_, res) => {
  res.send("✅ MrPhone Backend running for Mastercard Hosted Checkout!");
});

/* ====================================================
   💳 CREATE SESSION — Hosted Checkout
   ==================================================== */
app.post("/initiate-checkout", async (req, res) => {
  const { amount, currency = "USD", draftId, description, customer } = req.body;
  const orderId = draftId || `ORDER-${Date.now()}`;

  try {
    console.log(`🧾 Creating Hosted Checkout session for order ${orderId}...`);

    const response = await axios.post(
      `${process.env.HOST}/api/rest/version/71/merchant/${process.env.MERCHANT_ID}/session`,
      {
        apiOperation: "CREATE_SESSION",
        order: {
          id: orderId,
          amount,
          currency,
          description: description || `Order #${orderId}`,
        },
        interaction: {
          operation: "PURCHASE",
          operationMode: "HOSTED",
          returnUrl: `${process.env.PUBLIC_BASE_URL}/payment-result/${orderId}`,
          merchant: {
            name: "Mr. Phone Lebanon",
            logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          },
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

    const { session } = response.data;
    console.log("✅ Session created:", session.id);

    res.json({
      sessionId: session.id,
      redirectUrl: `${process.env.HOST}/checkout/pay/${session.id}`,
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

/* ====================================================
   💰 PAYMENT RESULT — Verify & Create Daftra Invoice
   ==================================================== */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    console.log(`🔍 Verifying order ${orderId}...`);

    const verify = await axios.get(
      `${process.env.HOST}/api/rest/version/71/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: `merchant.${process.env.MERCHANT_ID}`,
          password: process.env.API_PASSWORD,
        },
      }
    );

    const data = verify.data;
    const result = data.result?.toUpperCase() || "UNKNOWN";
    console.log(`💬 Payment result for ${orderId}: ${result}`);

    if (result === "SUCCESS") {
      // ✅ Check if invoice exists
      const existing = await axios.get(
        `https://www.mrphonelb.com/api2/invoices.json?search=${orderId}`,
        { headers: { APIKEY: process.env.DAFTRA_API_KEY } }
      );

      if (existing.data?.data?.length > 0) {
        console.log("⚠️ Invoice already exists, skipping creation.");
        return res.redirect("https://www.mrphonelb.com/client/contents/thankyou");
      }

      // ✅ Create new Daftra invoice
      const daftra = await axios.post(
        "https://www.mrphonelb.com/api2/invoices.json",
        {
          draft: false,
          name: `Invoice for ${orderId}`,
          currency: "USD",
          status: "paid",
          items: [{ name: "Online Order", price: data.amount, qty: 1 }],
        },
        {
          headers: {
            APIKEY: process.env.DAFTRA_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      const invoiceId = daftra.data.id;
      console.log("✅ Daftra invoice created:", invoiceId);

      return res.redirect(
        `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoiceId}`
      );
    }

    console.warn("❌ Payment failed or already processed.");
    res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
  } catch (err) {
    console.error("❌ Verification failed:", err.message);
    res.redirect("https://www.mrphonelb.com/client/invoices/pay?source=website_front");
  }
});

/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
});
