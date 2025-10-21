require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Env vars
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;

// 🔐 Daftra API key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 Temp memory
const TEMP_STORE = {};

/* ============================================================
   1️⃣  Create Mastercard session (NO draft yet)
============================================================ */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;
    if (!client_id || !items.length || !total) {
      return res.status(400).json({ error: "Missing client_id, items[], or total" });
    }

    const checkoutTotal = Number(total);
    const orderId = `ORDER-${Date.now()}-${client_id}`;
    console.log(`💳 Starting MPGS session | client:${client_id} | total:$${checkoutTotal}`);

    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: orderId,
        amount: checkoutTotal, // exact checkout total (no +3.5)
        currency,
        description: `Mr Phone - Order ${orderId}`
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          url: "https://www.mrphonelb.com"
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/${client_id}?orderId=${orderId}`,
        redirectMerchantUrl: "https://www.mrphonelb.com/client/contents/error?invoice_id=unknown",
        retryAttemptCount: 2,
        displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" }
      }
    };

    const resp = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000
      }
    );

    const data = resp.data;
    if (!data?.session?.id) throw new Error("MPGS did not return a session.id");

    // 🧠 Save full cart data
    TEMP_STORE[data.session.id] = {
      client_id,
      items,
      total: checkoutTotal,
      currency,
      orderId,
      sessionId: data.session.id
    };
    TEMP_STORE[orderId] = TEMP_STORE[data.session.id];

    console.log("✅ MPGS session created:", data.session.id);
    return res.json({
      ok: true,
      orderId,
      sessionId: data.session.id,
      session: data.session,
      successIndicator: data.successIndicator || null
    });
  } catch (err) {
    console.error("❌ Session creation error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message
    });
  }
});

/* ============================================================
   2️⃣  Verify payment → create Daftra draft + pending payment
============================================================ */
app.get("/verify-payment/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const { sessionId, orderId } = req.query;

    if (!orderId) {
  console.warn("⚠️ Missing orderId");
  return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
}


    const key = sessionId || orderId;
    const store = TEMP_STORE[key];
    if (!store) {
      console.warn("⚠️ Missing stored cart for:", key);
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    const { client_id, items, total, currency } = store;
    delete TEMP_STORE[key];

    console.log(`🔍 Verifying MPGS order ${orderId} with session ${sessionId}`);

    // ✅ Verify payment with both IDs
    const verify = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${orderId}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        params: { sessionId },
        timeout: 20000
      }
    );

    const v = verify.data || {};
    const result = v.result || v.status || "UNKNOWN";
    const status = v.order?.status || v.status || "UNKNOWN";
    const txnId =
      v.transaction?.id || v.order?.id || v.session?.id || sessionId;

    console.log("ℹ️ MPGS verify:", { result, status, txnId });

    const success =
      String(result).toUpperCase() === "SUCCESS" &&
      ["CAPTURED", "AUTHORIZED", "SUCCESS"].includes(String(status).toUpperCase());

    if (!success) {
      console.warn("⚠️ Payment not successful");
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    console.log("✅ Payment confirmed — creating Daftra draft invoice...");

    // ✅ Create draft invoice in Daftra (real items only)
    const draftPayload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: `✅ MPGS success. Txn: ${txnId}.`
      },
      InvoiceItem: items.map(i => ({
        item: i.item,
        description: i.description || "",
        unit_price: Number(i.unit_price),
        quantity: Number(i.quantity)
      }))
    };

    const draftRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      draftPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        },
        timeout: 20000
      }
    );

    const draft = draftRes.data;
    if (!draft?.id) throw new Error("Failed to create Daftra draft");
    console.log("🧾 Draft created:", draft.id);

    const draftTotal = items.reduce(
      (sum, i) => sum + Number(i.unit_price) * Number(i.quantity),
      0
    );

    // ✅ Create pending payment (same as draft total)
    const paymentPayload = {
      InvoicePayment: {
        invoice_id: Number(draft.id),
        payment_method: "Credit___Debit_Card",
        amount: Number(draftTotal),
        transaction_id: String(txnId),
        status: 0, // pending
        notes: "Pending Mastercard payment",
        currency_code: currency,
        processed: false
      }
    };

    const payRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoice_payments",
      paymentPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        },
        timeout: 20000
      }
    );

    console.log("💰 Pending payment created:", payRes.data?.id || "(no id)");

    return res.redirect(
      `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draft.id}`
    );
  } catch (err) {
    console.error("❌ Verification error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* ============================================================
   Health
============================================================ */
app.get("/", (_req, res) => {
  res.send("✅ MrPhone Mastercard backend running fine.");
});

app.listen(PORT, () => console.log(`✅ Server on :${PORT}`));
