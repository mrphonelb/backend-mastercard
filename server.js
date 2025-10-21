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

// 🧠 Temporary store
const SESSIONS = {};

/* =========================================================
   1️⃣ Create MPGS session for an existing draft invoice
========================================================= */
app.post("/create-mastercard-session-existing", async (req, res) => {
  try {
    const { invoice_id, client_id, total_gateway, currency = "USD" } = req.body;

    if (!invoice_id || !client_id || !total_gateway)
      return res.status(400).json({ ok: false, error: "Missing invoice_id, client_id, or total" });

    const orderId = `INV${invoice_id}-${Date.now()}`;
    console.log(`💳 Creating MPGS session for invoice #${invoice_id} | total: ${total_gateway}`);

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

    console.log(`✅ MPGS session created | session:${sessionId} | orderId:${orderId}`);
    res.json({ ok: true, session: { id: sessionId }, orderId });
  } catch (err) {
    console.error("❌ Session error:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: "Failed to create Mastercard session" });
  }
});

/* =========================================================
   ✅ Verify MPGS → Recreate same draft + pending payment
========================================================= */
app.get("/verify-payment-existing", async (req, res) => {
  try {
    const { orderId } = req.query;
    const ctx = SESSIONS[orderId];
    if (!ctx)
      return res.redirect("https://www.mrphonelb.com/client/contents/error?invoice_id=unknown");

    const { invoice_id, total_gateway, currency } = ctx;

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
      delete SESSIONS[orderId];
      return res.redirect(`https://www.mrphonelb.com/client/contents/error?invoice_id=${invoice_id}`);
    }

    // remove +3.5%
    const baseTotal = (Number(total_gateway) / 1.035).toFixed(2);

    // Get the original draft details
    const draftData = await axios.get(`https://www.mrphonelb.com/api2/invoices/${invoice_id}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${process.env.DAFTRA_BEARER}`,
      },
    });

    const original = draftData.data?.Invoice;
    if (!original) throw new Error("Unable to load original draft");

    // Recreate it as a new draft with a pending payment
    const payload = {
      Invoice: {
        client_id: original.client_id,
        draft: true,
        is_offline: true,
        currency_code: currency,
        notes: `Auto-created draft after MPGS success. Original draft #${invoice_id}`,
      },
      InvoiceItem: original.InvoiceItem?.map(i => ({
        item: i.item,
        description: i.description || "",
        unit_price: Number(i.unit_price),
        quantity: Number(i.quantity),
        product_id: i.product_id,
      })),
      Payment: [
        {
          payment_method: "Credit___Debit_Card",
          amount: Number(baseTotal),
          transaction_id: txnId,
          status: 2, // pending
          processed: false,
          notes: `Mastercard payment pending (Txn: ${txnId})`,
          currency_code: currency,
        },
      ],
    };

    const newDraft = await axios.post("https://www.mrphonelb.com/api2/invoices", payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DAFTRA_BEARER}`,
      },
    });

    console.log("✅ New draft created with pending payment:", newDraft.data?.id);
    delete SESSIONS[orderId];

    res.redirect(
      `https://www.mrphonelb.com/client/contents/thankyou?invoice_id=${newDraft.data?.id || invoice_id}`
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
  res.send("✅ MrPhone Backend — MPGS Existing Draft + 3.5% Adjusted + Email Ready")
);
app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);
