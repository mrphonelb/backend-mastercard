require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Environment variables
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";
const PORT = process.env.PORT || 10000;

/* ====================================================
   💳 1. Create Mastercard Checkout Session
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;
    if (!orderId || !amount || !currency)
      return res.status(400).json({ error: "Missing orderId, amount, or currency" });

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
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   🧾 2. Create Draft Invoice in Daftra
   ==================================================== */
app.post("/create-draft", async (req, res) => {
  try {
    const { client_id, items, total } = req.body;

    if (!client_id || !items || !total)
      return res.status(400).json({ error: "Missing client_id, items, or total" });

    const payload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: "USD",
        notes: "Online draft created from checkout",
      },
      InvoiceItem: items,
    };

    const response = await axios.post("https://www.mrphonelb.com/api2/invoices", payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: DAFTRA_API_KEY,
      },
      timeout: 15000,
    });

    console.log("✅ Draft Invoice Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Daftra Draft Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Daftra draft",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   💳 3. On Mastercard Payment Success → Mark Invoice Paid
   ==================================================== */
app.post("/payment-success", async (req, res) => {
  try {
    const { invoiceId, amount, transactionId } = req.body;
    if (!invoiceId || !amount || !transactionId)
      return res.status(400).json({ error: "Missing invoiceId, amount, or transactionId" });

    // Calculate base + fee separation (if needed)
    const fee = +(amount * 0.035).toFixed(2);
    const base = +(amount / 1.035).toFixed(2);

    const payload = {
      Invoice: {
        draft: false,
        payment_status: "paid",
        notes: "Auto-marked as paid after Mastercard success",
      },
      InvoiceItem: [
        {
          item: "Credit Card Fee",
          description: "3.5% Mastercard Processing Fee",
          unit_price: fee,
          quantity: 1,
        },
      ],
      Payment: [
        {
          payment_method: "Credit / Debit Card",
          amount: amount,
          transaction_id: transactionId,
          date: new Date().toISOString().slice(0, 19).replace("T", " "),
        },
      ],
    };

    const response = await axios.post(
      `https://www.mrphonelb.com/api2/invoices/${invoiceId}`,
      payload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY,
        },
        timeout: 15000,
      }
    );

    console.log("✅ Invoice Marked Paid:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Payment Update Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to mark invoice paid",
      debug: err.response?.data || err.message,
    });
  }
});

/* ====================================================
   🧠 Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend running: Mastercard + Daftra Hybrid Integration Ready.");
});

/* ====================================================
   🚀 Start Server
   ==================================================== */
app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
