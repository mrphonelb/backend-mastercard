require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Environment variables
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// 🔐 Daftra API key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 Temporary in-memory cart store
const TEMP_STORE = {};

/* ============================================================
   1️⃣ CREATE MPGS SESSION (no Daftra draft yet)
============================================================ */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;

    if (!client_id || !Array.isArray(items) || items.length === 0 || !total) {
      return res.status(400).json({ error: "Missing client_id, items[], or total" });
    }

    const checkoutTotal = Number(total);
    const orderId = `ORDER-${Date.now()}-${client_id}`;
    console.log(`💳 Starting MPGS session | client:${client_id} | total:$${checkoutTotal}`);

    // MPGS Payload
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: orderId,
        amount: checkoutTotal,
        currency,
        description: `Mr Phone LB - ${orderId}`,
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          url: "https://www.mrphonelb.com",
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/${client_id}?orderId=${orderId}`,
        redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=unknown`,
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
    if (!data?.session?.id) throw new Error("MPGS did not return session.id");

    // Save session for later
    TEMP_STORE[data.session.id] = { client_id, items, total: checkoutTotal, currency, orderId };
    TEMP_STORE[orderId] = TEMP_STORE[data.session.id];

    console.log("✅ MPGS session created:", data.session.id);
    return res.json({
      ok: true,
      session: data.session,
      successIndicator: data.successIndicator || null,
      orderId,
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
   2️⃣ VERIFY PAYMENT → CREATE DRAFT + PENDING PAYMENT
============================================================ */
app.get("/verify-payment/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const sessionId = req.query.sessionId;
    const orderId = req.query.orderId;

    const key = sessionId || orderId;
    if (!key || !TEMP_STORE[key]) {
      console.warn("⚠️ Missing stored cart for:", key);
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    const { client_id, items, total, currency } = TEMP_STORE[key];
    delete TEMP_STORE[key];

    console.log(`🔍 Verifying MPGS order ${key} for client ${client_id}`);

    // ✅ Check MPGS order status
    const verify = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
      }
    );

    const v = verify.data || {};
    const result = v.result || v.status || "UNKNOWN";
    const status = v.order?.status || v.status || "UNKNOWN";
    const txnId = v.transaction?.id || v.order?.id || orderId;

    console.log("ℹ️ MPGS verify:", { result, status, txnId });

    const success =
      String(result).toUpperCase() === "SUCCESS" &&
      ["CAPTURED", "AUTHORIZED", "SUCCESS"].includes(String(status).toUpperCase());

    if (!success) {
      console.warn("⚠️ Payment not successful");
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    console.log("✅ Payment success — creating DRAFT in Daftra");

    // ✅ Create Daftra DRAFT (kept draft, not finalized)
    const draftPayload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: `✅ MPGS payment approved (Txn: ${txnId}). Awaiting stock/IMEI confirmation before fulfillment.`,
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
      timeout: 20000,
    });

    const draft = draftRes.data;
    if (!draft?.id) throw new Error("Failed to create Daftra draft");
    console.log("🧾 Draft created:", draft.id);

    // ✅ Create PENDING payment
    const draftTotal = items.reduce(
      (sum, i) => sum + Number(i.unit_price) * Number(i.quantity),
      0
    );

    const paymentPayload = {
      InvoicePayment: {
        invoice_id: draft.id,
        payment_method: "Credit___Debit_Card",
        amount: draftTotal,
        transaction_id: txnId,
        status: 0, // pending
        processed: false,
        notes: "Mastercard payment pending (manual confirmation required).",
        currency_code: currency,
      },
    };

    await axios.post("https://www.mrphonelb.com/api2/invoice_payments", paymentPayload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: DAFTRA_API_KEY,
      },
      timeout: 20000,
    });

    console.log("💰 Pending payment added.");

    return res.redirect(
      `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draft.id}`
    );
  } catch (err) {
    console.error("❌ Verification error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* ============================================================
   🧠 HEALTH CHECK
============================================================ */
app.get("/", (_req, res) => {
  res.send("✅ MrPhone Backend Ready — MPGS Payment Flow (Draft + Pending Payment).");
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
