require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Environment
const HOST = process.env.HOST; // e.g. https://creditlibanais-netcommerce.gateway.mastercard.com
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 In-memory store (temporary mapping)
const SESSIONS = {};

/* =========================================================
   1️⃣  Create MPGS session for an EXISTING Daftra draft
========================================================= */
app.post("/create-mastercard-session-existing", async (req, res) => {
  try {
    const {
      invoice_id,
      client_id,
      total_gateway, // total including 3.5 %
      total_invoice, // real invoice total
      currency = "USD",
    } = req.body;

    if (!invoice_id || !client_id || !total_gateway || !total_invoice)
      return res.status(400).json({ ok: false, error: "Missing parameters" });

    const orderId = `INV${invoice_id}-${Date.now()}`;
    console.log(`💳 Creating MPGS session for invoice #${invoice_id}`);

    // MPGS payload
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: orderId,
        amount: Number(total_gateway),
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
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment-existing?orderId=${orderId}`,
        displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" },
      },
    };

    // Create session
    const resp = await axios.post(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/session`,
      payload,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
      }
    );

    const sessionId = resp.data?.session?.id;
    if (!sessionId) throw new Error("Missing MPGS session.id");

    // Store session context
    SESSIONS[orderId] = { invoice_id, client_id, total_gateway, total_invoice, currency };

    console.log(`✅ MPGS session ready | session:${sessionId} | orderId:${orderId}`);
    res.json({ ok: true, session: { id: sessionId }, orderId });
  } catch (err) {
    console.error("❌ Session error:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: "Failed to create Mastercard session" });
  }
});

/* =========================================================
   2️⃣  Verify MPGS result → add pending payment to draft
========================================================= */
app.get("/verify-payment-existing", async (req, res) => {
  try {
    const { orderId } = req.query;
    const ctx = SESSIONS[orderId];
    if (!ctx)
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");

    const { invoice_id, total_invoice, currency } = ctx;

    // Verify MPGS order
    const verify = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
      }
    );

    const v = verify.data || {};
    const result = (v.result || v.status || "").toUpperCase();
    const status = (v.order?.status || v.status || "").toUpperCase();
    const txnId =
      v.transaction?.id ||
      v.order?.id ||
      (Array.isArray(v.transactions) && v.transactions[0]?.transaction?.id) ||
      orderId;

    const success =
      result === "SUCCESS" &&
      ["CAPTURED", "AUTHORIZED", "SUCCESS"].includes(status);

    if (!success) {
      console.warn("⚠️ Payment not successful:", orderId);
      delete SESSIONS[orderId];
      return res.redirect(
        `https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`
      );
    }

    console.log(`✅ MPGS success — adding pending payment to draft #${invoice_id}`);

    // ✅ Create pending payment in Daftra
    const paymentPayload = {
      InvoicePayment: {
        invoice_id: Number(invoice_id),
        payment_method: "Credit___Debit_Card",
        amount: Number(total_invoice), // ✅ exact invoice total (no 3.5 %)
        transaction_id: txnId,
        status: 2, // ✅ 2 = pending
        processed: false,
        notes: `Mastercard payment pending (Txn: ${txnId})`,
        currency_code: currency,
        send_email: true,      // ✅ notify owner
        notify_client: true,   // ✅ notify customer
      },
    };

    await axios.post(
      "https://www.mrphonelb.com/api2/invoice_payments",
      paymentPayload,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: DAFTRA_API_KEY,
        },
      }
    );

    console.log(`💰 Pending payment (status:2) added to invoice #${invoice_id}`);
    delete SESSIONS[orderId];

    res.redirect(
      `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoice_id}`
    );
  } catch (err) {
    console.error("❌ verify-payment-existing error:", err.response?.data || err.message);
    res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* =========================================================
   Health Check
========================================================= */
app.get("/", (_, res) =>
  res.send("✅ MrPhone Backend — MPGS Existing-Draft + Pending Payment + Email ready")
);
app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);
