require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Environment
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 In-memory session store
const SESSIONS = {};

/* =========================================================
   1️⃣ Create MPGS session for an existing Daftra draft invoice
========================================================= */
app.post("/create-mastercard-session-existing", async (req, res) => {
  try {
    const { invoice_id, client_id, total, currency = "USD" } = req.body;

    if (!invoice_id || !client_id || !total) {
      return res.status(400).json({ ok: false, error: "Missing invoice_id, client_id, or total" });
    }

    const orderId = `INV${invoice_id}-${Date.now()}`;
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
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment-existing?orderId=${orderId}`,
        displayControl: {
          billingAddress: "HIDE",
          customerEmail: "HIDE",
        },
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

    const sessionId = resp.data?.session?.id;
    if (!sessionId) throw new Error("Missing MPGS session id");

    SESSIONS[orderId] = { invoice_id, client_id, total, currency };

    console.log(`✅ Created MPGS session for invoice #${invoice_id} | session:${sessionId}`);
    return res.json({ ok: true, session: { id: sessionId }, orderId });
  } catch (err) {
    console.error("❌ Error creating Mastercard session:", err.message);
    res.status(500).json({ ok: false, error: "Failed to create Mastercard session" });
  }
});

/* =========================================================
   2️⃣ Verify MPGS Payment → Add Pending Payment to Existing Draft
========================================================= */
app.get("/verify-payment-existing", async (req, res) => {
  try {
    const { orderId } = req.query;
    const ctx = SESSIONS[orderId];
    if (!ctx) {
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    const { invoice_id, total, currency } = ctx;

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
      console.warn("⚠️ Payment failed:", orderId);
      delete SESSIONS[orderId];
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`);
    }

    // ✅ Add pending payment to the existing Daftra draft
    const paymentPayload = {
      InvoicePayment: {
        invoice_id: Number(invoice_id),
        payment_method: "Credit___Debit_Card",
        amount: Number(total),
        transaction_id: txnId,
        status: 2, // Pending
        processed: false,
        notes: `Mastercard payment pending (Txn: ${txnId})`,
        currency_code: currency,
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

    console.log(`💰 Pending payment added to existing draft #${invoice_id}`);
    delete SESSIONS[orderId];

    return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${invoice_id}`);
  } catch (err) {
    console.error("❌ Verify payment error:", err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* =========================================================
   Health Check
========================================================= */
app.get("/", (_, res) =>
  res.send("✅ MrPhone Backend — MPGS (Existing Draft) + Pending Payment Ready")
);
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
