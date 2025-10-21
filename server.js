require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json()); // 🔥 required before routes

// 🔐 ENV variables
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// 🔐 Daftra key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 temp in-memory store
const TEMP_STORE = {};

/* ============================================================
   1️⃣  CREATE MPGS SESSION — no draft yet
============================================================ */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    console.log("📦 Incoming body:", req.body);

    const { client_id, invoice_id, total, currency = "USD", items = [] } = req.body;
    if (!client_id || !invoice_id || !total)
      return res.status(400).json({ error: "Missing client_id, invoice_id, or total" });

    const amount = Number(total);
    console.log(`💳 Starting MPGS session | invoice:${invoice_id} | total:$${amount}`);

    const orderId = `ORDER-${invoice_id}-${Date.now()}`;

    // ✅ valid MPGS payload (no merchant.url, no redirectMerchantUrl)
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: orderId,
        amount,
        currency,
        description: `Mr Phone LB — Invoice #${invoice_id}`,
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/${client_id}?invoice_id=${invoice_id}&orderId=${orderId}`,
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
      }
    );

    const data = resp.data;
    if (!data?.session?.id) throw new Error("Missing MPGS session.id");

    // store invoice + cart temporarily
    TEMP_STORE[data.session.id] = { client_id, invoice_id, total: amount, currency, items, orderId };

    console.log("✅ MPGS session created:", data.session.id);
    res.json({ ok: true, session: data.session, successIndicator: data.successIndicator });
  } catch (err) {
    console.error("❌ Session creation error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message,
    });
  }
});

/* ============================================================
   2️⃣  VERIFY PAYMENT — then create Daftra DRAFT + pending PAYMENT
============================================================ */
app.get("/verify-payment/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { sessionId, invoice_id, orderId } = req.query;
    const key = sessionId || orderId;

    if (!key || !TEMP_STORE[key]) {
      console.warn("⚠️ Missing stored session/cart for:", key);
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    const { client_id, items, total, currency } = TEMP_STORE[key];
    delete TEMP_STORE[key];

    console.log(`🔍 Verifying MPGS session ${key} for invoice ${invoice_id}`);

    const verifyResp = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session/${sessionId}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
      }
    );

    const v = verifyResp.data || {};
    const result = v.result || "UNKNOWN";
    const status = v.order?.status || v.status || "UNKNOWN";
    const txnId =
      v.transaction?.id || v.order?.id || v.session?.id || sessionId || "UNKNOWN_TXN";

    console.log("ℹ️ MPGS verify:", { result, status, txnId });

    const success =
      result.toUpperCase() === "SUCCESS" &&
      ["CAPTURED", "AUTHORIZED", "SUCCESS"].includes(status.toUpperCase());

    if (!success) {
      console.warn("⚠️ Payment failed or canceled");
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=" + invoice_id);
    }

    console.log("✅ Payment success, creating Daftra DRAFT + pending payment...");

    // ✅ Create Daftra draft invoice
    const draftPayload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: `✅ Mastercard transaction ${txnId} — draft created after successful payment.`,
      },
      InvoiceItem: items.map((i) => ({
        item: i.item,
        description: i.description || "",
        unit_price: Number(i.unit_price),
        quantity: Number(i.quantity),
      })),
    };

    const draftRes = await axios.post("https://www.mrphonelb.com/api2/invoices", draftPayload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: DAFTRA_API_KEY,
      },
    });

    const draft = draftRes.data;
    if (!draft?.id) throw new Error("Failed to create Daftra draft");

    const draftTotal = items.reduce(
      (sum, i) => sum + Number(i.unit_price) * Number(i.quantity),
      0
    );

    // ✅ Create pending payment (not marked paid)
    const paymentPayload = {
      InvoicePayment: {
        invoice_id: draft.id,
        payment_method: "Credit___Debit_Card",
        amount: draftTotal,
        transaction_id: txnId,
        status: 0, // pending
        notes: "Mastercard (pending)",
        currency_code: currency,
        processed: false,
      },
    };

    await axios.post("https://www.mrphonelb.com/api2/invoice_payments", paymentPayload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: DAFTRA_API_KEY,
      },
    });

    console.log("🧾 Draft + pending payment created:", draft.id);
    return res.redirect(
      `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draft.id}`
    );
  } catch (err) {
    console.error("❌ Verify error:", err.response?.data || err.message);
    res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* ============================================================
   3️⃣  HEALTH CHECK
============================================================ */
app.get("/", (_req, res) => res.send("✅ MrPhone MPGS + Daftra backend ready."));

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
