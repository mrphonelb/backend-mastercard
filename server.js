require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());

/* ✅ Allow your website domain */
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS.split(","),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const PORT = process.env.PORT || 3000;

/* 🩺 Health check */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running — Daftra + Mastercard integrated");
});

/* =======================================================
   🧾 1. Create Daftra invoice using API Key
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
   💳 2. Create Mastercard Hosted Checkout Session
   ======================================================= */
app.post("/initiate-checkout", async (req, res) => {
  try {
    const { invoiceData, totalAmount } = req.body;

    console.log("🧾 Creating Daftra invoice...");
    const invoice = await createDaftraInvoice(invoiceData);
    console.log("✅ Daftra invoice created:", invoice.id);

    const orderId = `ORDER-${Date.now()}`;
    const payload = {
      apiOperation: "CREATE_CHECKOUT_SESSION",
      interaction: {
        operation: "PURCHASE",
        merchant: { name: "Mr Phone LB", address: { line1: "Lebanon" } },
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
    console.error("💥 Checkout error:", error.response?.data || error.message);
    res.status(500).json({
      result: "ERROR",
      message: error.response?.data || error.message,
    });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
