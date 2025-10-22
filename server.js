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

const SESSIONS = {};

/* =========================================================
   1️⃣ Create MPGS session for existing draft invoice
========================================================= */
app.post("/create-mastercard-session-existing", async (req, res) => {
  try {
    const { invoice_id, client_id, total_gateway, currency = "USD" } = req.body;
    if (!invoice_id || !client_id || !total_gateway)
      return res.status(400).json({ ok: false, error: "Missing parameters" });

    const orderId = `INV${invoice_id}-${Date.now()}`;
    console.log(`💳 Creating MPGS session for invoice #${invoice_id}`);

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
        },
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment-existing?orderId=${orderId}`,
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

    const sessionId = resp.data?.session?.id;
    if (!sessionId) throw new Error("Missing MPGS session id");

    SESSIONS[orderId] = { invoice_id, client_id, total_gateway, currency };
    res.json({ ok: true, session: { id: sessionId }, orderId });
  } catch (err) {
    console.error("❌ Session error:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: "Failed to create Mastercard session" });
  }
});

/* =========================================================
   2️⃣ Verify MPGS → Add Pending Payment + Keep Draft
========================================================= */
app.get("/verify-payment-existing", async (req, res) => {
  try {
    const { orderId } = req.query;
    const ctx = SESSIONS[orderId];
    if (!ctx)
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");

    const { invoice_id, total_gateway, currency } = ctx;

    // ✅ Verify MPGS order
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

    const message =
      v.error?.explanation ||
      v.acquirerMessage ||
      v.gatewayCode ||
      v.result ||
      "Unknown response";

    const success =
      result === "SUCCESS" &&
      ["CAPTURED", "AUTHORIZED", "SUCCESS"].includes(status);

    // ✅ Adjust amount (remove +3.5%)
    const baseTotal = (Number(total_gateway) / 1.035).toFixed(2);
    const time = encodeURIComponent(new Date().toLocaleString());

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      apikey: DAFTRA_API_KEY,
    };

    if (!success) {
      console.warn("⚠️ Payment failed:", orderId, "| Reason:", message);
      delete SESSIONS[orderId];
      return res.redirect(
        `https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}` +
        `&order_id=${orderId}` +
        `&txn_id=${txnId}` +
        `&amount=${baseTotal}` +
        `&time=${time}` +
        `&message=${encodeURIComponent(message)}`
      );
    }

    // ✅ Step 1: Add pending payment
    await axios.post(
      "https://www.mrphonelb.com/api2/invoice_payments",
      {
        InvoicePayment: {
          invoice_id: Number(invoice_id),
          payment_method: "Credit___Debit_Card",
          amount: Number(baseTotal),
          transaction_id: txnId,
          treasury_id: 0,
          status: "2",        // pending
          processed: "0",
          response_message: "Pending approval (Mastercard verification)",
          notes: `Mastercard payment pending (Txn: ${txnId})`,
          currency_code: currency,
        },
      },
      { headers }
    );

    // ✅ Step 2: Force invoice to remain draft
    await axios.put(
      `https://www.mrphonelb.com/api2/invoices/${invoice_id}`,
      { Invoice: { draft: true } },
      { headers }
    );

    delete SESSIONS[orderId];
    console.log(`✅ Draft kept + pending payment recorded for #${invoice_id}`);

    return res.redirect(
      `https://www.mrphonelb.com/client/contents/thankyou` +
      `?invoice_id=${invoice_id}` +
      `&order_id=${orderId}` +
      `&txn_id=${txnId}` +
      `&amount=${baseTotal}` +
      `&time=${time}` +
      `&message=${encodeURIComponent("Payment Authorized")}`
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
  res.send("✅ MrPhone Backend — Draft Locked, Pending Payment, Redirect Details Enabled")
);

app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);
