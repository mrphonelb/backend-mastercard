require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Environment variables
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// 🔐 Daftra API Key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 TEMP STORE (holds session → cart)
const TEMP_STORE = {};

/* ============================================================
   💳 STEP 1: Create MPGS session (no draft yet)
============================================================ */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD", invoice_id } = req.body;

    if (!client_id || !total || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Missing client_id, total, or items[]" });
    }

    console.log(`💳 Starting MPGS session | invoice:${invoice_id} | total:$${total}`);

   // ✅ Build Mastercard checkout payload
const orderId = `ORDER-${Date.now()}-${invoice_id}`;
const returnUrl = `https://mrphone-backend.onrender.com/verify-payment/${client_id}?invoice_id=${invoice_id}&sessionId={session.id}`; 
// MPGS replaces {session.id} automatically

const payload = {
  apiOperation: "INITIATE_CHECKOUT",
  checkoutMode: "WEBSITE",
  order: {
    id: orderId,
    amount: Number(total),
    currency,
    description: `Mr Phone LB - Invoice ${invoice_id}`,
  },
  interaction: {
    operation: "PURCHASE",
    merchant: {
      name: "Mr Phone Lebanon",
      logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
      url: "https://www.mrphonelb.com",
    },
    returnUrl, // ✅ session.id will be replaced at runtime by Mastercard
    redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`,
    retryAttemptCount: 2,
    displayControl: {
      billingAddress: "HIDE",
      customerEmail: "HIDE",
    },
  },
};


    // Create session
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

    // Store session + cart
    // ✅ Store session and also invoice ID for fallback
TEMP_STORE[data.session.id] = { client_id, items, total, currency, invoice_id };
TEMP_STORE[invoice_id] = TEMP_STORE[data.session.id]; // fallback lookup if sessionId missing
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
   💳 STEP 2: Verify payment → Create draft + pending payment
============================================================ */
app.get("/verify-payment/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const sessionIdFromQuery = req.query.sessionId;
const invoice_id = req.query.invoice_id;

// ✅ Lookup stored data
const stored =
  (sessionIdFromQuery && TEMP_STORE[sessionIdFromQuery]) ||
  (invoice_id && TEMP_STORE[invoice_id]);

if (!stored) {
  console.warn("⚠️ Missing stored session/cart for:", sessionIdFromQuery || invoice_id);
  return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`);
}

// ✅ Extract real sessionId from stored object
const { client_id, items, currency, sessionId } = stored;
const actualSessionId = sessionId || sessionIdFromQuery;

delete TEMP_STORE[actualSessionId];
delete TEMP_STORE[invoice_id];

console.log(`🔍 Verifying MPGS session ${actualSessionId} for invoice ${invoice_id}`);


    // Get session status
  const verify = await axios.get(
  `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session/${actualSessionId}`,
  {
    auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
    headers: { "Content-Type": "application/json" },
  }
);


    const v = verify.data;
    const result = v.result || v.status;
    const status = v.order?.status || v.status;
    const txnId = v.transaction?.id || sessionId;

    const success =
      String(result).toUpperCase() === "SUCCESS" &&
      ["CAPTURED", "AUTHORIZED", "SUCCESS"].includes(String(status).toUpperCase());

    if (!success) {
      console.warn("⚠️ Payment not successful:", { result, status });
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`);
    }

    console.log("✅ Payment confirmed, creating Daftra draft...");

    // Create draft (exact items)
    const draftRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      {
        Invoice: {
          client_id,
          draft: true,
          is_offline: true,
          currency_code: currency,
          notes: `✅ MPGS success Txn:${txnId} | Awaiting manual stock/IMEI confirmation.`,
        },
        InvoiceItem: items.map((i) => ({
          item: i.item,
          description: i.description || "",
          unit_price: Number(i.unit_price),
          quantity: Number(i.quantity),
        })),
      },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY,
        },
      }
    );

    const draft = draftRes.data;
    if (!draft?.id) throw new Error("Failed to create Daftra draft");

    console.log("🧾 Draft created:", draft.id);

    // Create pending payment
    const totalWithoutFee = items.reduce(
      (sum, i) => sum + Number(i.unit_price) * Number(i.quantity),
      0
    );

    const payRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoice_payments",
      {
        InvoicePayment: {
          invoice_id: draft.id,
          payment_method: "Credit___Debit_Card",
          amount: totalWithoutFee,
          transaction_id: txnId,
          status: 0,
          processed: false,
          notes: "Pending Mastercard payment verification — 3.5% fee excluded.",
        },
      },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY,
        },
      }
    );

    console.log("💰 Pending payment created:", payRes.data?.id);
    return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draft.id}`);
  } catch (err) {
    console.error("❌ Verify error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* ============================================================
   🔍 Health check
============================================================ */
app.get("/", (_req, res) => res.send("✅ MrPhone Mastercard backend running (final)."));
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
