require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Env
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// 🔐 Daftra (API key auth)
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 Temp store: sessionId -> { client_id, items, total, currency }
const TEMP_STORE = {};

/* ============================================================
   1) Create Mastercard Session (NO draft yet)
   - Stores cart in TEMP_STORE under the MPGS sessionId
============================================================ */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;

    if (!client_id || !Array.isArray(items) || items.length === 0 || !total) {
      return res.status(400).json({ error: "Missing client_id, items[], or total" });
    }

    const checkoutTotal = Number(total); // ← EXACT checkout total (no +3.5 here)
    console.log(`💳 Starting MPGS session | client:${client_id} | total:$${checkoutTotal}`);

    // In create-mastercard-session
const orderId = `ORDER-${Date.now()}-${client_id}`;
const payload = {
  apiOperation: "INITIATE_CHECKOUT",
  checkoutMode: "WEBSITE",
  order: {
    id: orderId, // ✅ show this in the payment gateway
    amount: checkoutTotal,
    currency,
    description: `Mr Phone LB - ${orderId}`
  },
  interaction: {
    operation: "PURCHASE",
    merchant: {
      name: "Mr Phone Lebanon",
      logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
      url: "https://www.mrphonelb.com"
    },
    returnUrl: `https://mrphone-backend.onrender.com/verify-payment/${client_id}?orderId=${orderId}`,
    redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=unknown`,
    retryAttemptCount: 2,
    displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" }
  }
};

// Save in TEMP_STORE by both IDs
TEMP_STORE[data.session.id] = { client_id, items, total: checkoutTotal, currency };
TEMP_STORE[orderId] = TEMP_STORE[data.session.id];


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
    if (!data?.session?.id) throw new Error("MPGS did not return a session.id");

    // Store cart for use after success
    TEMP_STORE[data.session.id] = { client_id, items, total: checkoutTotal, currency };

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
   2) Verify Payment → Create Daftra DRAFT + Pending PAYMENT
   - Draft items/amounts = EXACT checkout cart (no fee)
   - Payment = SAME amount as draft, status = 0 (pending)
============================================================ */
app.get("/verify-payment/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const sessionId = req.query.sessionId;
    const orderId = req.query.orderId;

    const key = sessionId || orderId; // ✅ use whichever is available
    if (!key || !TEMP_STORE[key]) {
      console.warn("⚠️ Missing stored cart for:", key);
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    const { client_id, items, total, currency } = TEMP_STORE[key];
    delete TEMP_STORE[key]; // cleanup memory

    console.log(`🔍 Verifying MPGS session/order ${key} for client ${client_id}`);

    // Get session status/result
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
    // Some gateways expose order.status, some expose status directly
    const status = v.order?.status || v.status || "UNKNOWN";
    const txnId =
      v.transaction?.id ||
      v.order?.id ||
      v.session?.id ||
      sessionId; // fallback if gateway doesn't provide explicit transaction id

    console.log("ℹ️ MPGS verify:", { result, status, txnId });

    const success =
      String(result).toUpperCase() === "SUCCESS" &&
      ["CAPTURED", "AUTHORIZED", "SUCCESS"].includes(String(status).toUpperCase());

    if (!success) {
      console.warn("⚠️ Payment not successful");
      return res.redirect(
        "https://www.mrphonelb.com/client/contents/error?invoice_id=unknown"
      );
    }

    console.log("✅ Payment confirmed — creating draft invoice in Daftra...");

    // Create DAFTRA DRAFT with real items (NO fee)
    const draftPayload = {
      Invoice: {
        client_id,
        draft: true, // keep draft
        is_offline: true,
        currency_code: currency,
        notes: `✅ MPGS payment success. Txn: ${txnId}. Amount charged at gateway may include processor fee; draft shows product totals only.`,
      },
      InvoiceItem: items.map((i) => ({
        item: i.item, // NAME - must match product/service name
        description: i.description || "",
        unit_price: Number(i.unit_price),
        quantity: Number(i.quantity),
        // (optional) tax1, tax2, product_id, etc. if you use them
      })),
    };

    const draftRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      draftPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY,
        },
        timeout: 20000,
      }
    );

    const draft = draftRes.data;
    if (!draft?.id) throw new Error("Failed to create Daftra draft after payment");
    console.log("🧾 Draft created:", draft.id);

    // Calculate draft total (same as original cart total, no fee)
    const draftTotal = items.reduce(
      (sum, i) => sum + Number(i.unit_price) * Number(i.quantity),
      0
    );

    // Create PENDING PAYMENT for same amount as draft (NOT gateway amount)
    const paymentPayload = {
      InvoicePayment: {
        invoice_id: Number(draft.id),
        payment_method: "Credit___Debit_Card", // as you requested
        amount: Number(draftTotal),
        transaction_id: String(txnId),
        status: 0, // 0 = pending; you'll click "Receive payment" later
        notes: "Mastercard (pending). Amount equals draft total; card fee not recorded in Daftra.",
        currency_code: currency,
        processed: false, // keep as not processed
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

    // ✅ Redirect to thank-you with the created draft ID
    return res.redirect(
      `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draft.id}`
    );
  } catch (err) {
    console.error("❌ Verification error:", err.response?.data || err.message);
    return res.redirect(
      "https://www.mrphonelb.com/client/contents/error?invoice_id=unknown"
    );
  }
});

/* ============================================================
   Health
============================================================ */
app.get("/", (_req, res) => {
  res.send("✅ MrPhone Mastercard backend running.");
});

app.listen(PORT, () => console.log(`✅ Server on :${PORT}`));
