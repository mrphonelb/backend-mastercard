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
const PORT = process.env.PORT || 10000;

// ✅ Daftra API key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 Temporary store for payment session data
const TEMP_STORE = {};

/* ============================================================
   1️⃣ CREATE MPGS SESSION (existing draft invoice)
============================================================ */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { invoice_id, client_id, total } = req.body;
    if (!invoice_id || !client_id || !total)
      return res.status(400).json({ error: "Missing invoice_id, client_id, or total" });

    const orderId = `INV${invoice_id}-${Date.now()}`;
    console.log(`💳 Creating MPGS session for invoice #${invoice_id} | total: ${total}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      order: {
        id: orderId,
        amount: total,
        currency: "USD",
        description: `MrPhoneLB Invoice #${invoice_id}`,
      },
      interaction: {
        operation: "PURCHASE",
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment-existing/${invoice_id}?orderId=${orderId}`,
        displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" },
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
        },
      },
    };

    const response = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
      }
    );

    const data = response.data;
    TEMP_STORE[data.session.id] = { invoice_id, client_id, total, orderId };

    console.log("✅ MPGS session created:", data.session.id);
    res.json({ ok: true, session: data.session, orderId });
  } catch (err) {
    console.error("❌ create-mastercard-session error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create session", debug: err.response?.data || err.message });
  }
});

/* ============================================================
   2️⃣ VERIFY PAYMENT AND ADD PENDING PAYMENT TO SAME DRAFT
============================================================ */
app.get("/verify-payment-existing/:invoiceId", async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { orderId } = req.query;
    const sessionData = TEMP_STORE[orderId];

    if (!sessionData) {
      console.warn("⚠️ Missing session data for order:", orderId);
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=" + invoiceId);
    }

    const { total, client_id } = sessionData;
    console.log(`🔍 Verifying payment for invoice #${invoiceId} (order ${orderId})`);

    // ✅ Verify MPGS order status
    const verify = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
      }
    );

    const result = verify.data.result || verify.data.order?.status || "UNKNOWN";
    const success = String(result).toUpperCase().includes("SUCCESS") || String(result).toUpperCase().includes("CAPTURED");

    if (!success) {
      console.warn("⚠️ Payment failed or not captured");
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=" + invoiceId);
    }

    // ✅ Calculate actual Daftra payment (remove 3.5%)
    const amountPaid = (Number(total) / 1.035).toFixed(2);
    const txnId = orderId;
    console.log(`💰 Payment success for #${invoiceId} | Amount: ${amountPaid} | Txn: ${txnId}`);

    // ✅ Create pending payment in Daftra
    const paymentPayload = {
      InvoicePayment: {
        invoice_id: Number(invoiceId),
        payment_method: "Credit___Debit_Card",
        amount: amountPaid,
        transaction_id: txnId,
        status: 2, // ✅ pending
        processed: false,
        notes: "Mastercard payment pending verification.",
        currency_code: "USD",
      },
    };

    await axios.post("https://www.mrphonelb.com/api2/invoice_payments", paymentPayload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: DAFTRA_API_KEY,
      },
    });

    console.log("🧾 Pending payment created successfully in Daftra.");

    // ✅ Redirect to Thank You page
    res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoiceId}`);
  } catch (err) {
    console.error("❌ verify-payment-existing error:", err.response?.data || err.message);
    res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* ============================================================
   🧠 HEALTH CHECK
============================================================ */
app.get("/", (req, res) => {
  res.send("✅ MrPhone Backend Ready — Daftra + Mastercard Integration (API Key Only).");
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
