require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Mastercard credentials
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// ✅ Daftra API credentials
const DAFTRA_API = "https://www.mrphonelb.com/api2/invoices";
const DAFTRA_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

/* ====================================================
   💳 CREATE MASTERCARD SESSION
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;
    if (!orderId || !amount || !currency)
      return res.status(400).json({ error: "Missing orderId, amount, or currency." });

    console.log(`💰 Creating Mastercard session for ${amount} ${currency} | Order: ${orderId}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          url: "https://www.mrphonelb.com",
        },
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE",
          shipping: "HIDE",
        },
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout",
      },
      order: {
        id: orderId,
        amount: amount,
        currency: currency,
        description: "Mr Phone Lebanon Online Purchase",
      },
    };

    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: {
          username: `merchant.${MERCHANT_ID}`,
          password: API_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log("✅ Mastercard Session Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Mastercard Session Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create session",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   🧾 CREATE DAFTRA INVOICE AFTER SUCCESSFUL PAYMENT
   ==================================================== */
app.post("/payment-success", async (req, res) => {
  try {
    const { client_id, base_amount, session_id } = req.body;

    if (!client_id || !base_amount || !session_id) {
      console.error("❌ Missing fields in body:", req.body);
      return res.status(400).json({ error: "Missing client_id, base_amount, or session_id" });
    }

    console.log(`🧾 Creating Daftra Paid Invoice for client_id: ${client_id}`);

    const fee = +(base_amount * 0.035).toFixed(2);
    const total = +(base_amount + fee).toFixed(2);
    const today = new Date().toISOString().split("T")[0];

    const invoicePayload = {
      Invoice: {
        client_id: client_id,
        date: today,
        currency_code: "USD",
        draft: false,
        payment_status: "paid",
        name: "Online Mastercard Payment",
        notes: `Mastercard Payment Session: ${session_id}`,
        is_offline: true,
      },
      InvoiceItem: [
        {
          item: "Online Order",
          description: "Mr Phone LB Online Purchase",
          unit_price: base_amount,
          quantity: 1,
        },
        {
          item: "Card Payment Fee (3.5%)",
          description: "Processing Fee",
          unit_price: fee,
          quantity: 1,
        },
      ],
      Payment: [
        {
          payment_method: "Credit / Debit Card",
          amount: total,
          transaction_id: session_id,
          date: new Date().toISOString().replace("T", " ").slice(0, 19),
        },
      ],
      InvoiceCustomField: {},
      Deposit: {},
      InvoiceReminder: {},
      Document: {},
      DocumentTitle: {},
    };

    console.log("📤 Sending Invoice to Daftra:", JSON.stringify(invoicePayload, null, 2));

    const daftraResponse = await axios.post(DAFTRA_API, invoicePayload, {
      headers: {
        Accept: "application/json",
        apikey: DAFTRA_KEY,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });

    console.log("✅ Daftra Invoice Created:", daftraResponse.data);
    res.json(daftraResponse.data);
  } catch (err) {
    console.error("❌ Daftra Invoice Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Daftra invoice",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   🧠 HEALTH CHECK
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend Ready — Mastercard + Daftra Integration (Paid Invoice)");
});

/* ====================================================
   🚀 START SERVER
   ==================================================== */
app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
