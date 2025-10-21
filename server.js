require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Environment variables
const HOST = process.env.HOST;               // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// 🔐 Daftra API key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 Temporary store
const TEMP_STORE = {};

/* ============================================================
   1️⃣  Create Mastercard Session (existing Daftra draft)
============================================================ */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, invoice_id, total, currency = "USD" } = req.body;

    if (!client_id || !invoice_id || !total) {
      return res.status(400).json({ error: "Missing client_id, invoice_id, or total" });
    }

    const checkoutTotal = Number(total);
    console.log(`💳 Starting MPGS session | invoice:${invoice_id} | total:$${checkoutTotal}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: `DRAFT-${invoice_id}`,
        amount: checkoutTotal,
        currency,
        description: `Mr Phone Lebanon | Invoice #${invoice_id}`,
      },
      interaction: {
  operation: "PURCHASE",
  merchant: {
    name: "Mr Phone Lebanon",
    logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
    url: "https://www.mrphonelb.com",
  },
  // ✅ Fix: pass sessionId dynamically via MPGS placeholder
  returnUrl: `https://mrphone-backend.onrender.com/verify-payment/${client_id}?invoice_id=${invoice_id}&sessionId={checkoutSession.id}`,
  redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`,
  retryAttemptCount: 2,
  displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" },
},
    };

    const resp = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
      }
    );

    const data = resp.data;
    if (!data?.session?.id) throw new Error("Failed to create MPGS session");

    TEMP_STORE[data.session.id] = { client_id, invoice_id, total: checkoutTotal, currency };

    console.log("✅ MPGS session created:", data.session.id);
    return res.json({
      ok: true,
      session: data.session,
      successIndicator: data.successIndicator || null,
    });
  } catch (err) {
    console.error("❌ Session creation error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message,
    });
  }
});

/* ============================================================
   2️⃣  Verify Payment → add pending payment in Daftra
============================================================ */
app.get("/verify-payment/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { sessionId, invoice_id } = req.query;

    if (!sessionId || !TEMP_STORE[sessionId]) {
      console.warn("⚠️ Missing stored session/cart for:", sessionId);
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`);
    }

    const { client_id, total, currency } = TEMP_STORE[sessionId];
    delete TEMP_STORE[sessionId];

    console.log(`🔍 Verifying MPGS session ${sessionId} for invoice ${invoice_id}`);

    // 🔎  Verify with Mastercard
    const verify = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session/${sessionId}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
      }
    );

    const v = verify.data || {};
    const result = v.result || v.status || "UNKNOWN";
    const status = v.order?.status || v.status || "UNKNOWN";
    const txnId = v.transaction?.id || v.order?.id || v.session?.id || sessionId;

    console.log("ℹ️ MPGS verify:", { result, status, txnId });

    const success =
      String(result).toUpperCase() === "SUCCESS" &&
      ["CAPTURED", "AUTHORIZED", "SUCCESS"].includes(String(status).toUpperCase());

    if (!success) {
      console.warn("⚠️ Payment not successful");
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`);
    }

    console.log("✅ Payment success — creating pending payment record...");

    // 🧾  Create pending payment only (do NOT close invoice)
    const paymentPayload = {
      InvoicePayment: {
        invoice_id: Number(invoice_id),
        payment_method: "Credit___Debit_Card",
        amount: Number(total),
        transaction_id: String(txnId),
        status: 0, // 0 = pending
        notes: "Mastercard payment success — pending confirmation.",
        currency_code: currency,
        processed: false,
      },
    };

    const payRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoice_payments",
      paymentPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY,
        },
        timeout: 20000,
      }
    );

    console.log("💰 Pending payment created:", payRes.data?.id || "(no id)");
    return res.redirect(
      `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoice_id}`
    );
  } catch (err) {
    console.error("❌ Verification error:", err.response?.data || err.message);
    return res.redirect(
      "https://www.mrphonelb.com/client/contents/error?invoice_id=unknown"
    );
  }
});

/* ============================================================
   🧩  Health check
============================================================ */
app.get("/", (_req, res) => {
  res.send("✅ MrPhone Mastercard backend ready — using Daftra draft invoices.");
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
