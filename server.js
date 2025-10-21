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

// ✅ Daftra API Key
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// ✅ Temporary store for order data (simple in-memory)
const TEMP_STORE = {};

/* ====================================================
   💳 1) Create Mastercard Session (no Daftra draft yet)
   ==================================================== */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;

    if (!client_id || !total || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Missing client_id, total, or items[]" });
    }

    const checkoutTotal = Number(total); // includes +3.5% fee
    console.log(`💳 Starting MPGS session | Client:${client_id} | Amount:$${checkoutTotal}`);

    // ✅ Build MPGS payload
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: `TEMP-${Date.now()}`,
        amount: checkoutTotal,
        currency,
        description: "Mr Phone LB Online Checkout"
      },
      interaction: {
        operation: "PURCHASE",
        merchant: {
          name: "Mr Phone Lebanon",
          logo: "https://www.mrphonelb.com/s3/files/91010354/shop_front/media/sliders/87848095-961a-4d20-b7ce-2adb572e445f.png",
          url: "https://www.mrphonelb.com"
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment/${client_id}`,
        redirectMerchantUrl: `https://www.mrphonelb.com/client/contents/error?invoice_id=unknown`,
        retryAttemptCount: 2,
        displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" }
      }
    };

    // ✅ Create session with Mastercard
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
    if (!data.session?.id) throw new Error("Failed to create MPGS session");

    // ✅ Store order info temporarily
    TEMP_STORE[data.session.id] = { client_id, items, currency };
    console.log("✅ MPGS session created:", data.session.id);

    return res.json({
      ok: true,
      session: data.session,
      successIndicator: data.successIndicator
    });
  } catch (err) {
    console.error("❌ Session creation error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Mastercard session",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   💳 2) Verify Payment → Create Draft + Payment + Finalize
   ==================================================== */
app.get("/verify-payment/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;
    const sessionId = req.query.sessionId; // MPGS appends ?sessionId=...

    if (!sessionId || !TEMP_STORE[sessionId]) {
      console.warn("⚠️ Missing order data for session:", sessionId);
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    const { client_id, items, currency } = TEMP_STORE[sessionId];
    delete TEMP_STORE[sessionId]; // cleanup memory

    console.log(`🔍 Verifying MPGS session ${sessionId} for client ${client_id}`);

    // ✅ Retrieve MPGS session result
    const verify = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session/${sessionId}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" }
      }
    );

    const data = verify.data;
    const result = data.result;
    const status = data.status;
    const paidAmount = data.order?.amount || data.amount;

    if (!(result === "SUCCESS" && (status === "CAPTURED" || status === "AUTHORIZED"))) {
      console.warn("⚠️ Payment failed or cancelled:", { result, status });
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    console.log("✅ Payment success — creating Daftra draft & payment record...");

    // ✅ 1. Create Daftra draft with real items (no 3.5% fee)
    const draftResp = await axios.post(
      "https://www.mrphonelb.com/api2/invoices",
      {
        Invoice: {
          client_id,
          draft: true,
          is_offline: true,
          currency_code: currency,
          notes: `✅ MPGS payment confirmed. Customer charged $${paidAmount} (includes +3.5% fee not recorded in Daftra).`
        },
        InvoiceItem: items.map(i => ({
          item: i.item,
          description: i.description || "",
          unit_price: Number(i.unit_price),
          quantity: Number(i.quantity)
        }))
      },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        }
      }
    );

    const draft = draftResp.data;
    if (!draft?.id) throw new Error("Failed to create Daftra draft");
    console.log("✅ Draft created:", draft.id);

    // ✅ 2. Record payment (no fee, with transaction ID)
    const totalWithoutFee = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    const transactionId = sessionId; // use MPGS session as Txn reference

    const paymentPayload = {
      InvoicePayment: {
        invoice_id: draft.id,
        payment_method: "Credit___Debit_Card", // Daftra internal key
        amount: totalWithoutFee,
        transaction_id: transactionId,
        notes: `💳 Online Mastercard payment confirmed. Customer paid $${paidAmount} (includes +3.5% fee not in Daftra).`,
        processed: true
      }
    };

    const paymentRes = await axios.post(
      "https://www.mrphonelb.com/api2/invoice_payments",
      paymentPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        }
      }
    );

    console.log("💰 Payment recorded:", paymentRes.data);

    // ✅ 3. Finalize draft → issued invoice
    await axios.put(
      `https://www.mrphonelb.com/api2/invoices/${draft.id}`,
      {
        Invoice: {
          draft: false,
          notes: `✅ Finalized after successful Mastercard payment (Txn: ${transactionId})`
        }
      },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        }
      }
    );

    console.log(`📄 Draft ${draft.id} finalized as normal invoice`);
    return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draft.id}`);
  } catch (err) {
    console.error("❌ Verification error:", err.response?.data || err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* ====================================================
   🧾 Manual Test Endpoints
   ==================================================== */
app.post("/create-draft", async (req, res) => {
  try {
    const { client_id, total, currency_code = "USD", items = [] } = req.body;
    if (!client_id || !total || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Missing client_id, total, or items[]" });
    }

    const payload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code,
        notes: "✅ Manual test draft via backend"
      },
      InvoiceItem: items.map(i => ({
        item: i.item,
        description: i.description || "",
        unit_price: Number(i.unit_price),
        quantity: Number(i.quantity)
      }))
    };

    const response = await axios.post("https://www.mrphonelb.com/api2/invoices", payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: DAFTRA_API_KEY
      }
    });

    console.log("✅ Daftra draft created:", response.data);
    return res.json(response.data);
  } catch (err) {
    console.error("❌ Daftra draft error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Daftra draft",
      debug: err.response?.data || err.message
    });
  }
});

app.post("/create-payment", async (req, res) => {
  try {
    const { invoice_id, amount, payment_method = "Credit___Debit_Card" } = req.body;
    if (!invoice_id || !amount) {
      return res.status(400).json({ error: "Missing invoice_id or amount" });
    }

    const payload = {
      InvoicePayment: {
        invoice_id,
        payment_method,
        amount: Number(amount),
        notes: "💳 Manual payment via Mastercard (for testing)",
        processed: true
      }
    };

    const response = await axios.post(
      "https://www.mrphonelb.com/api2/invoice_payments",
      payload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY
        }
      }
    );

    console.log("✅ Payment created successfully:", response.data);
    return res.json(response.data);
  } catch (err) {
    console.error("❌ Payment creation error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to create Daftra payment",
      debug: err.response?.data || err.message
    });
  }
});

/* ====================================================
   🧠 3) Health Check
   ==================================================== */
app.get("/", (req, res) => {
  res.send(
    "✅ MrPhone Backend Ready — MPGS → Daftra draft → payment → finalize invoice (no fee in Daftra)."
  );
});

app.listen(PORT, () =>
  console.log(`✅ MrPhone backend running on port ${PORT}`)
);
