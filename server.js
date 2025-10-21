require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Env vars
const HOST = process.env.HOST;
const MERCHANT_ID = process.env.MERCHANT_ID;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 10000;
const DAFTRA_API_KEY = "dd904f6a2745e5206ea595caac587a850e990504";

// 🧠 In-memory store
const TEMP = {};

/* =========================================================
   1️⃣ CREATE MPGS SESSION (no Daftra draft yet)
========================================================= */
app.post("/create-mastercard-session", async (req, res) => {
  try {
    const { client_id, items = [], total, currency = "USD" } = req.body;
    if (!client_id || !Array.isArray(items) || !items.length || !total)
      return res.status(400).json({ error: "Missing client_id, items[], or total" });

    const orderId = `ORDER-${Date.now()}-${client_id}`;
    const payload = {
      apiOperation: "INITIATE_CHECKOUT",
      checkoutMode: "WEBSITE",
      order: {
        id: orderId,
        amount: Number(total),
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
        returnUrl: `https://mrphone-backend.onrender.com/verify-payment?orderId=${orderId}`,
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

    if (!resp.data?.session?.id)
      throw new Error("Missing MPGS session id");

    TEMP[orderId] = { client_id, items, total, currency };
    return res.json({ ok: true, session: resp.data.session, orderId });
  } catch (err) {
    console.error("❌ Session Error:", err.message);
    res.status(500).json({ error: "Failed to create Mastercard session" });
  }
});

/* =========================================================
   2️⃣ VERIFY PAYMENT → CREATE DRAFT + PENDING PAYMENT
========================================================= */
app.get("/verify-payment", async (req, res) => {
  try {
    const { orderId } = req.query;
    const orderData = TEMP[orderId];
    if (!orderId || !orderData)
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");

    const { client_id, items, total, currency } = orderData;

    // Verify MPGS order
    const verify = await axios.get(
      `${HOST}/api/rest/version/100/merchant/${MERCHANT_ID}/order/${encodeURIComponent(orderId)}`,
      {
        auth: { username: `merchant.${MERCHANT_ID}`, password: API_PASSWORD },
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
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
      console.warn("⚠️ Payment failed for order", orderId);
      delete TEMP[orderId];
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
    }

    console.log("✅ MPGS success, creating Daftra draft...");

    // ✅ Create Daftra draft invoice
    const draftPayload = {
      Invoice: {
        client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: `✅ Payment through Mastercard Gateway (Txn: ${txnId}) — Pending verification.`,
      },
      InvoiceItem: items.map(i => ({
        item: i.item,
        description: i.description || "",
        unit_price: Number(i.unit_price),
        quantity: Number(i.quantity),
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
    if (!draft?.id) throw new Error("Failed to create Daftra draft invoice");

    console.log("🧾 Draft invoice created:", draft.id);

    // ✅ Create Pending Payment for the same draft
    const paymentPayload = {
      InvoicePayment: {
        invoice_id: draft.id,
        payment_method: "Credit___Debit_Card",
        amount: Number(total),
        transaction_id: txnId,
        status: 0, // Pending
        processed: false,
        notes: `Mastercard payment pending (Txn: ${txnId}).`,
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

    console.log("💰 Pending payment recorded.");
    delete TEMP[orderId];

    // ✅ Redirect to thank-you
    return res.redirect(`https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${draft.id}`);
  } catch (err) {
    console.error("❌ Verify Error:", err.message);
    return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");
  }
});

/* =========================================================
   HEALTH CHECK
========================================================= */
app.get("/", (_, res) => res.send("✅ MPGS + Daftra Draft Pending Flow Ready"));
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
