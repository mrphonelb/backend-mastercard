require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";
const PORT = process.env.PORT || 10000;

/* ====================================================
   💳 1. Create Mastercard Session (with +3.5% fee)
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;
    if (!orderId || !amount || !currency)
      return res.status(400).json({ error: "Missing orderId, amount, or currency." });

    // ✅ Add 3.5% Mastercard fee
    const chargedAmount = (parseFloat(amount) * 1.035).toFixed(2);

    console.log(`💰 Creating Mastercard session for ${chargedAmount} ${currency} | Order: ${orderId}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          url: "https://www.mrphonelb.com"
        },
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE",
          shipping: "HIDE"
        },
        returnUrl: "https://www.mrphonelb.com/client/contents/checkout"
      },
      order: {
        id: orderId,
        amount: chargedAmount,
        currency,
        description: "Mr Phone Lebanon Online Purchase (+3.5% card fee)"
      }
    };

    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" }
      }
    );

    console.log("✅ Mastercard Session Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Mastercard Session Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   💵 2. Create Daftra Paid Invoice (after payment success)
   ==================================================== */
app.post("/payment-success", async (req, res) => {
  try {
    const { client_id, client_name, client_email, base_amount, session_id } = req.body;

    if (!base_amount || !session_id)
      return res.status(400).json({ error: "Missing base_amount or session_id" });

    const fee = +(base_amount * 0.035).toFixed(2);
    const totalPaid = +(base_amount + fee).toFixed(2);
    const today = new Date().toISOString().split("T")[0];

    const payload = {
      Invoice: {
        client_id: client_id || 0,
        client_first_name: client_name || "Online Customer",
        client_email: client_email || "",
        date: today,
        currency_code: "USD",
        draft: false,
        payment_status: "paid",
        name: "Mr Phone LB Online Purchase",
        notes: `Paid via Mastercard (Session: ${session_id})`,
        total: totalPaid
      },
      InvoiceItem: [
        {
          item: "Online Order",
          description: "Checkout Payment",
          unit_price: base_amount,
          quantity: 1
        },
        {
          item: "Card Payment Fee (3.5%)",
          description: "Processing fee for Mastercard payment",
          unit_price: fee,
          quantity: 1
        }
      ],
      Payment: [
        {
          payment_method: "Credit / Debit Card (Mastercard)",
          amount: totalPaid,
          transaction_id: session_id,
          date: new Date().toISOString().replace("T", " ").slice(0, 19)
        }
      ]
    };

    const response = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "apikey": "dd904f6a2745e5206ea595caac587a850e990504"
        }
      }
    );

    console.log("✅ Daftra Invoice Created:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("❌ Daftra Invoice Creation Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Daftra invoice",
      debug: err.response?.data || err.message
    });
  }
});


/* ====================================================
   🧠 3. Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend ready for Mastercard (+3.5% fee) and Daftra integration.");
});

/* ====================================================
   🚀 Start Server
   ==================================================== */
app.listen(PORT, () => {
  console.log(`✅ MrPhone backend running on port ${PORT}`);
});
