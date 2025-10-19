require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());

/* =======================================================
   🌐 CORS
   ======================================================= */
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS.split(","),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const PORT = process.env.PORT || 3000;

/* =======================================================
   🩺 HEALTH CHECK
   ======================================================= */
app.get("/", (_, res) => {
  res.send("✅ MrPhone Backend running — Mastercard + Daftra API integrated");
});

/* =======================================================
   🧾 Create Daftra Invoice (with API Key)
   ======================================================= */
async function createDaftraInvoice(invoiceData) {
  const res = await axios.post(
    `${process.env.DAFTRA_BASE_URL}/invoices`,
    invoiceData,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `api_key ${process.env.DAFTRA_API_KEY}`,
      },
    }
  );
  return res.data;
}

/* =======================================================
   💳 INITIATE CHECKOUT
   ======================================================= */
app.post("/initiate-checkout", async (req, res) => {
  try {
    const { invoiceData, totalAmount } = req.body;
    const orderId = `ORDER-${Date.now()}`;

    console.log("🧾 Creating Daftra invoice...");
    const invoice = await createDaftraInvoice(invoiceData);
    console.log("✅ Daftra invoice created:", invoice.id);

    const payload = {
      apiOperation: "CREATE_CHECKOUT_SESSION",
      interaction: {
        operation: "PURCHASE",
        merchant: { name: "Mr Phone Lebanon" },
      },
      order: {
        id: orderId,
        amount: parseFloat(totalAmount).toFixed(2),
        currency: "USD",
        description: `Invoice #${invoice.id}`,
      },
    };

    console.log("💳 Creating Mastercard session...");
    const { data } = await axios.post(
      `${process.env.HOST}/api/rest/version/71/merchant/${process.env.MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: process.env.MERCHANT_ID,
          password: process.env.API_PASSWORD,
        },
      }
    );

    console.log("✅ Mastercard session created:", data.session.id);
    res.json({
      result: "SUCCESS",
      session: data.session,
      orderId,
      invoiceId: invoice.id,
    });
  } catch (error) {
    console.error("❌ INITIATE CHECKOUT ERROR:", error.response?.data || error.message);
    res.status(500).json({
      result: "ERROR",
      message: error.response?.data || error.message,
    });
  }
});

/* =======================================================
   🧾 PAYMENT RESULT (Verify + Update Invoice)
   ======================================================= */
app.get("/payment-result/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    console.log(`🔍 Verifying order ${orderId}...`);

    const verify = await axios.get(
      `${process.env.HOST}/api/rest/version/71/merchant/${process.env.MERCHANT_ID}/order/${orderId}`,
      {
        auth: {
          username: process.env.MERCHANT_ID,
          password: process.env.API_PASSWORD,
        },
      }
    );

    const result = verify.data.result?.toUpperCase() || "UNKNOWN";
    console.log(`💬 MPGS result for ${orderId} → ${result}`);

    if (result === "SUCCESS" || result === "CAPTURED") {
      console.log("✅ Payment successful. Redirecting to Thank You...");
      return res.redirect(process.env.THANKYOU_URL);
    } else {
      console.warn("❌ Payment failed. Redirecting to Error page...");
      return res.redirect(process.env.ERROR_URL);
    }
  } catch (err) {
    console.error("💥 Verification failed:", err.message);
    return res.redirect(process.env.ERROR_URL);
  }
});

/* =======================================================
   🚀 START SERVER
   ======================================================= */
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
